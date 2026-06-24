// GET  /api/support/threads          — list the caller's threads
//                                       ?scope=all → superadmin: every workspace thread
// POST /api/support/threads          — create a support ticket (JSON body)

import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { requireBearerUser, requireBearerTeamRole } from "@/lib/auth/require";
import { consume } from "@/lib/rate-limit";
import {
  getSupportAdminClient,
  resolveWorkspaceId,
  resolveActiveSupportWorkspace,
  resolveUserName,
  parseAttachmentClaims,
  buildAttachmentsFromClaims,
  notifyAdminOfTicket,
  recordSupportAudit,
  SupportValidationError,
} from "@/lib/support/server";
import { rowToThread, rowToMessage } from "@/lib/support/types";
import type { SupportThreadRow, SupportMessageRow, SupportAttachment } from "@/lib/support/types";
import {
  SUPPORT_ISSUE_CATEGORIES,
  SUPPORT_MIN_BODY,
  SUPPORT_MAX_BODY,
} from "@/lib/support/format";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const scope = new URL(request.url).searchParams.get("scope");

  if (scope === "all") {
    // Superadmin inbox — every thread in the workspace.
    const adminAuth = await requireBearerTeamRole(request, ["superadmin"]);
    if (adminAuth instanceof NextResponse) return adminAuth;
    const admin = getSupportAdminClient();
    const workspaceId = adminAuth.workspaceId || await resolveWorkspaceId(admin, adminAuth.user.id);
    const { data, error } = await admin
      .from("support_threads")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("last_message_at", { ascending: false })
      .limit(500);
    if (error) {
      console.error("[support/threads] admin list failed:", error.message);
      return NextResponse.json({ error: "Failed to load threads" }, { status: 500 });
    }
    return NextResponse.json({ threads: (data as SupportThreadRow[]).map(rowToThread) });
  }

  const auth = await requireBearerUser(request);
  if (auth instanceof NextResponse) return auth;
  const admin = getSupportAdminClient();
  const email = (auth.user.email ?? "").toLowerCase();
  const workspaceId = await resolveActiveSupportWorkspace(admin, auth.user.id, email);
  if (!workspaceId) return NextResponse.json({ error: "No active workspace access" }, { status: 403 });
  const { data, error } = await admin
    .from("support_threads")
    .select("*")
    .eq("created_by", auth.user.id)
    .eq("workspace_id", workspaceId)
    .order("last_message_at", { ascending: false })
    .limit(100);
  if (error) {
    console.error("[support/threads] list failed:", error.message);
    return NextResponse.json({ error: "Failed to load threads" }, { status: 500 });
  }
  return NextResponse.json({ threads: (data as SupportThreadRow[]).map(rowToThread) });
}

export async function POST(request: NextRequest) {
  const auth = await requireBearerUser(request);
  if (auth instanceof NextResponse) return auth;

  const rl = await consume("support:create", auth.user.id, 5, 3600);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "You're submitting tickets too quickly. Please wait a few minutes." },
      { status: 429 },
    );
  }

  let payload: { body?: unknown; category?: unknown; attachments?: unknown };
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const body = String(payload.body ?? "").trim();
  const category = payload.category ? String(payload.category) : null;
  const claims = parseAttachmentClaims(payload.attachments);

  if (body.length < SUPPORT_MIN_BODY) {
    return NextResponse.json({ error: "Please describe the issue." }, { status: 400 });
  }
  if (body.length > SUPPORT_MAX_BODY) {
    return NextResponse.json({ error: "Your description is too long." }, { status: 400 });
  }
  if (category && !SUPPORT_ISSUE_CATEGORIES.some((c) => c.id === category)) {
    return NextResponse.json({ error: "Unknown issue type" }, { status: 400 });
  }

  const admin = getSupportAdminClient();
  const email = (auth.user.email ?? "").toLowerCase();
  const workspaceId = await resolveActiveSupportWorkspace(admin, auth.user.id, email);
  if (!workspaceId) return NextResponse.json({ error: "No active workspace access" }, { status: 403 });
  const name = await resolveUserName(admin, email, workspaceId);

  let attachments: SupportAttachment[] = [];
  try {
    attachments = await buildAttachmentsFromClaims({
      admin,
      workspaceId,
      userId: auth.user.id,
      claims,
    });
  } catch (err) {
    if (err instanceof SupportValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error("[support/threads] attachment verify failed:", err);
    return NextResponse.json({ error: "Could not attach your file. Please try again." }, { status: 500 });
  }

  const threadId = randomUUID();
  const messageId = randomUUID();
  const subject = body.split("\n")[0].slice(0, 80);

  const { data: threadRow, error: threadErr } = await admin
    .from("support_threads")
    .insert({
      id: threadId,
      workspace_id: workspaceId,
      created_by: auth.user.id,
      created_by_email: email,
      created_by_name: name,
      kind: "ticket",
      subject,
      category,
      status: "open",
      last_sender_type: "user",
      unread_for_user: false,
      unread_for_admin: true,
    })
    .select("*")
    .single();
  if (threadErr || !threadRow) {
    console.error("[support/threads] thread insert failed:", threadErr?.message);
    return NextResponse.json({ error: "Could not create your ticket. Please try again." }, { status: 500 });
  }

  const { data: messageRow, error: msgErr } = await admin
    .from("support_messages")
    .insert({
      id: messageId,
      thread_id: threadId,
      workspace_id: workspaceId,
      sender_type: "user",
      sender_name: name,
      body,
      attachments,
    })
    .select("*")
    .single();
  if (msgErr || !messageRow) {
    console.error("[support/threads] message insert failed:", msgErr?.message);
    // Roll back the orphan thread so the inbox stays clean.
    await admin.from("support_threads").delete().eq("id", threadId);
    return NextResponse.json({ error: "Could not create your ticket. Please try again." }, { status: 500 });
  }

  await recordSupportAudit({
    admin,
    action: "ticket_created",
    threadId,
    workspaceId,
    actorName: name,
    details: `Ticket created: ${subject}`,
  });
  await notifyAdminOfTicket({ admin, thread: threadRow as SupportThreadRow, body, attachments });

  return NextResponse.json({
    thread: rowToThread(threadRow as SupportThreadRow),
    message: rowToMessage(messageRow as SupportMessageRow),
  });
}
