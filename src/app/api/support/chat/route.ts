// GET  /api/support/chat — the caller's single live-chat thread + messages
// POST /api/support/chat — send a chat message; lazily creates the chat thread
//
// Each user has at most one kind='chat' thread. The first message creates it.
// The superadmin answers chat threads from the same Support Inbox as tickets.

import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { requireBearerUser } from "@/lib/auth/require";
import { consume } from "@/lib/rate-limit";
import {
  getSupportAdminClient,
  resolveWorkspaceId,
  resolveUserName,
  findChatThread,
  getOrCreateChatThread,
  parseAttachmentClaims,
  buildAttachmentsFromClaims,
  resignAttachments,
  notifyAdminOfMessage,
  recordSupportAudit,
  SupportValidationError,
} from "@/lib/support/server";
import { rowToThread, rowToMessage } from "@/lib/support/types";
import type {
  SupportThreadRow,
  SupportMessageRow,
  SupportMessage,
  SupportAttachment,
} from "@/lib/support/types";
import { SUPPORT_MAX_BODY } from "@/lib/support/format";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const auth = await requireBearerUser(request);
  if (auth instanceof NextResponse) return auth;

  const admin = getSupportAdminClient();
  const workspaceId = await resolveWorkspaceId(admin, auth.user.id);
  const thread = await findChatThread(admin, auth.user.id, workspaceId);
  if (!thread) return NextResponse.json({ thread: null, messages: [] });

  const { data: msgRows, error } = await admin
    .from("support_messages")
    .select("*")
    .eq("thread_id", thread.id)
    .order("created_at", { ascending: true });
  if (error) {
    console.error("[support/chat] messages load failed:", error.message);
    return NextResponse.json({ error: "Failed to load chat" }, { status: 500 });
  }

  const messages: SupportMessage[] = await Promise.all(
    ((msgRows as SupportMessageRow[]) || []).map(async (r) => {
      const fresh = await resignAttachments(admin, r.attachments);
      return rowToMessage({ ...r, attachments: fresh });
    }),
  );
  return NextResponse.json({ thread: rowToThread(thread), messages });
}

export async function POST(request: NextRequest) {
  const auth = await requireBearerUser(request);
  if (auth instanceof NextResponse) return auth;

  const rl = await consume("support:msg", auth.user.id, 60, 60);
  if (!rl.allowed) {
    return NextResponse.json({ error: "You're sending messages too quickly." }, { status: 429 });
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

  const admin = getSupportAdminClient();
  const workspaceId = await resolveWorkspaceId(admin, auth.user.id);
  const email = (auth.user.email ?? "").toLowerCase();
  const name = await resolveUserName(admin, email);

  let thread: SupportThreadRow;
  try {
    thread = await getOrCreateChatThread({
      admin,
      workspaceId,
      ownerUserId: auth.user.id,
      ownerEmail: email,
      ownerName: name,
    });
  } catch (err) {
    console.error("[support/chat] thread open failed:", err);
    return NextResponse.json({ error: "Could not start the chat. Please try again." }, { status: 500 });
  }

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
    console.error("[support/chat] attachment verify failed:", err);
    return NextResponse.json({ error: "Could not attach your file." }, { status: 500 });
  }

  const { data: messageRow, error: msgErr } = await admin
    .from("support_messages")
    .insert({
      id: randomUUID(),
      thread_id: thread.id,
      workspace_id: workspaceId,
      sender_type: "user",
      sender_name: name,
      body: body || null,
      attachments,
    })
    .select("*")
    .single();
  if (msgErr || !messageRow) {
    console.error("[support/chat] message insert failed:", msgErr?.message);
    return NextResponse.json({ error: "Could not send your message." }, { status: 500 });
  }

  const nextStatus =
    thread.status === "resolved" || thread.status === "closed" ? "open" : thread.status;
  const nowIso = new Date().toISOString();
  await admin
    .from("support_threads")
    .update({
      last_message_at: nowIso,
      last_sender_type: "user",
      status: nextStatus,
      unread_for_admin: true,
      updated_at: nowIso,
    })
    .eq("id", thread.id);

  await notifyAdminOfMessage({ admin, thread: { ...thread, status: nextStatus }, body: body || null });
  await recordSupportAudit({
    admin,
    action: "support_message",
    threadId: thread.id,
    workspaceId,
    actorName: name,
    details: "Chat message",
  });

  return NextResponse.json({
    thread: rowToThread({
      ...thread,
      status: nextStatus,
      last_sender_type: "user",
      unread_for_admin: true,
      last_message_at: nowIso,
    }),
    message: rowToMessage(messageRow as SupportMessageRow),
  });
}
