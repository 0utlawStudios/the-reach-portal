// POST /api/support/threads/[id]/messages — append a message to a thread.
// The sender is the thread owner (a "user" message) or the superadmin (an
// "admin" reply); anyone else gets a 404 so thread existence is not leaked.

import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { isValidUuid } from "@/lib/utils";
import { requireBearerUser } from "@/lib/auth/require";
import { consume } from "@/lib/rate-limit";
import {
  getSupportAdminClient,
  getTeamRole,
  resolveUserName,
  resolveWorkspaceId,
  parseAttachmentClaims,
  buildAttachmentsFromClaims,
  notifyAdminOfMessage,
  notifyUserOfReply,
  recordSupportAudit,
  SupportValidationError,
} from "@/lib/support/server";
import { rowToMessage } from "@/lib/support/types";
import type {
  SupportThreadRow,
  SupportMessageRow,
  SupportAttachment,
  SupportSenderType,
  SupportThreadStatus,
} from "@/lib/support/types";
import { SUPPORT_MAX_BODY } from "@/lib/support/format";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireBearerUser(request);
  if (auth instanceof NextResponse) return auth;
  const { id } = await ctx.params;
  if (!isValidUuid(id)) return NextResponse.json({ error: "Invalid thread id" }, { status: 400 });

  const rl = await consume("support:msg", auth.user.id, 60, 60);
  if (!rl.allowed) {
    return NextResponse.json({ error: "You're sending messages too quickly." }, { status: 429 });
  }

  const admin = getSupportAdminClient();
  const { data: threadRow, error: threadErr } = await admin
    .from("support_threads")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (threadErr) {
    console.error("[support/messages] thread load failed:", threadErr.message);
    return NextResponse.json({ error: "Failed to load thread" }, { status: 500 });
  }
  if (!threadRow) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const thread = threadRow as SupportThreadRow;

  // Resolve the sender: thread owner → user; superadmin → admin; else 404.
  const isOwner = thread.created_by === auth.user.id;
  let senderType: SupportSenderType;
  if (isOwner) {
    senderType = "user";
  } else {
    const role = await getTeamRole(admin, auth.user.email ?? "", auth.user.id);
    if (role !== "superadmin") return NextResponse.json({ error: "Not found" }, { status: 404 });
    // Multi-tenant guard: a superadmin only reaches threads in their own workspace.
    const callerWorkspaceId = await resolveWorkspaceId(admin, auth.user.id);
    if (thread.workspace_id !== callerWorkspaceId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    senderType = "admin";
  }

  let payload: { body?: unknown; attachments?: unknown };
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const body = String(payload.body ?? "").trim();
  const claims = parseAttachmentClaims(payload.attachments);
  if (body.length === 0 && claims.length === 0) {
    return NextResponse.json({ error: "Message is empty." }, { status: 400 });
  }
  if (body.length > SUPPORT_MAX_BODY) {
    return NextResponse.json({ error: "Your message is too long." }, { status: 400 });
  }

  let attachments: SupportAttachment[] = [];
  try {
    attachments = await buildAttachmentsFromClaims({
      admin,
      workspaceId: thread.workspace_id,
      userId: auth.user.id,
      claims,
    });
  } catch (err) {
    if (err instanceof SupportValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error("[support/messages] attachment verify failed:", err);
    return NextResponse.json({ error: "Could not attach your file. Please try again." }, { status: 500 });
  }

  const senderName = isOwner
    ? thread.created_by_name
    : await resolveUserName(admin, auth.user.email ?? "");
  const messageId = randomUUID();

  const { data: messageRow, error: msgErr } = await admin
    .from("support_messages")
    .insert({
      id: messageId,
      thread_id: id,
      workspace_id: thread.workspace_id,
      sender_type: senderType,
      sender_name: senderName,
      body: body || null,
      attachments,
    })
    .select("*")
    .single();
  if (msgErr || !messageRow) {
    console.error("[support/messages] insert failed:", msgErr?.message);
    return NextResponse.json({ error: "Could not send your message." }, { status: 500 });
  }

  // A user message reopens a resolved/closed thread; an admin reply moves an
  // open thread to in_progress.
  let nextStatus: SupportThreadStatus = thread.status;
  if (senderType === "user" && (thread.status === "resolved" || thread.status === "closed")) {
    nextStatus = "open";
  } else if (senderType === "admin" && thread.status === "open") {
    nextStatus = "in_progress";
  }

  const nowIso = new Date().toISOString();
  await admin
    .from("support_threads")
    .update({
      last_message_at: nowIso,
      last_sender_type: senderType,
      status: nextStatus,
      unread_for_user: senderType === "admin",
      unread_for_admin: senderType === "user",
      updated_at: nowIso,
    })
    .eq("id", id);

  // Notifications read the debounce timestamps from the pre-update thread row.
  const freshThread: SupportThreadRow = { ...thread, status: nextStatus };
  if (senderType === "user") {
    await notifyAdminOfMessage({ admin, thread: freshThread, body: body || null });
    await recordSupportAudit({
      admin,
      action: "support_message",
      threadId: id,
      workspaceId: thread.workspace_id,
      actorName: senderName,
      details: "User replied",
    });
  } else {
    await notifyUserOfReply({ admin, thread: freshThread, body: body || null });
    await recordSupportAudit({
      admin,
      action: "support_reply",
      threadId: id,
      workspaceId: thread.workspace_id,
      actorName: senderName,
      details: "Team replied",
    });
  }

  return NextResponse.json({ message: rowToMessage(messageRow as SupportMessageRow) });
}
