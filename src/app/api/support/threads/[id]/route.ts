// GET   /api/support/threads/[id] — thread detail + messages (owner or superadmin)
// PATCH /api/support/threads/[id] — superadmin updates the thread status

import { NextRequest, NextResponse } from "next/server";
import { isValidUuid } from "@/lib/utils";
import { requireBearerUser, requireBearerTeamRole } from "@/lib/auth/require";
import {
  getSupportAdminClient,
  getTeamRole,
  resolveActiveSupportWorkspace,
  workspaceIdFromHeaders,
  resignAttachments,
  recordSupportAudit,
  resolveUserName,
} from "@/lib/support/server";
import { rowToThread, rowToMessage } from "@/lib/support/types";
import type {
  SupportThreadRow,
  SupportMessageRow,
  SupportMessage,
  SupportThreadStatus,
} from "@/lib/support/types";

export const runtime = "nodejs";
export const maxDuration = 30;

const STATUSES: SupportThreadStatus[] = ["open", "in_progress", "resolved", "closed"];

export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireBearerUser(request);
  if (auth instanceof NextResponse) return auth;
  const { id } = await ctx.params;
  if (!isValidUuid(id)) return NextResponse.json({ error: "Invalid thread id" }, { status: 400 });

  const admin = getSupportAdminClient();
  const { data: threadRow, error } = await admin
    .from("support_threads")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    console.error("[support/thread] load failed:", error.message);
    return NextResponse.json({ error: "Failed to load thread" }, { status: 500 });
  }
  if (!threadRow) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const thread = threadRow as SupportThreadRow;
  const callerWorkspaceId = await resolveActiveSupportWorkspace(admin, auth.user.id, auth.user.email ?? "", workspaceIdFromHeaders(request.headers));
  const isOwner = thread.created_by === auth.user.id && thread.workspace_id === callerWorkspaceId;
  if (!isOwner) {
    const role = await getTeamRole(admin, auth.user.email ?? "", auth.user.id, callerWorkspaceId);
    // Don't reveal that the thread exists to anyone but its owner / superadmin.
    if (role !== "superadmin") return NextResponse.json({ error: "Not found" }, { status: 404 });
    // Multi-tenant guard: a superadmin only reaches threads in their own workspace.
    if (thread.workspace_id !== callerWorkspaceId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
  }

  const { data: msgRows, error: msgErr } = await admin
    .from("support_messages")
    .select("*")
    .eq("thread_id", id)
    .order("created_at", { ascending: true });
  if (msgErr) {
    console.error("[support/thread] messages load failed:", msgErr.message);
    return NextResponse.json({ error: "Failed to load messages" }, { status: 500 });
  }

  const messages: SupportMessage[] = await Promise.all(
    ((msgRows as SupportMessageRow[]) || []).map(async (r) => {
      const fresh = await resignAttachments(admin, r.attachments);
      return rowToMessage({ ...r, attachments: fresh });
    }),
  );

  return NextResponse.json({ thread: rowToThread(thread), messages });
}

export async function PATCH(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const adminAuth = await requireBearerTeamRole(request, ["superadmin"]);
  if (adminAuth instanceof NextResponse) return adminAuth;
  const { id } = await ctx.params;
  if (!isValidUuid(id)) return NextResponse.json({ error: "Invalid thread id" }, { status: 400 });

  let payload: { status?: unknown };
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const status = String(payload.status ?? "");
  if (!STATUSES.includes(status as SupportThreadStatus)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }

  const admin = getSupportAdminClient();
  const workspaceId = adminAuth.workspaceId;
  const { data: threadRow, error } = await admin
    .from("support_threads")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("workspace_id", workspaceId)
    .select("*")
    .maybeSingle();
  if (error) {
    console.error("[support/thread] status update failed:", error.message);
    return NextResponse.json({ error: "Failed to update status" }, { status: 500 });
  }
  if (!threadRow) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const thread = threadRow as SupportThreadRow;
  const actorName = await resolveUserName(admin, adminAuth.email, workspaceId);
  await recordSupportAudit({
    admin,
    action: "support_status_changed",
    threadId: id,
    workspaceId: thread.workspace_id,
    actorName,
    details: `Status set to ${status}`,
  });
  return NextResponse.json({ thread: rowToThread(thread) });
}
