// POST /api/support/admin/start-chat — the superadmin opens a live-chat thread
// with a chosen teammate. Body: { email }.
//
// The recipient must be an ACTIVE member of the caller's own workspace; the
// resolve_workspace_member RPC (migration 0029) enforces that at the DB level,
// so this can never reach a user in another workspace. The thread is created
// empty — the admin's first message goes through /threads/[id]/messages like
// any other reply.

import { NextRequest, NextResponse } from "next/server";
import { requireBearerTeamRole } from "@/lib/auth/require";
import { consume } from "@/lib/rate-limit";
import {
  getSupportAdminClient,
  resolveWorkspaceId,
  resolveUserName,
  getOrCreateChatThread,
} from "@/lib/support/server";
import { rowToThread } from "@/lib/support/types";
import type { SupportThreadRow } from "@/lib/support/types";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: NextRequest) {
  const adminAuth = await requireBearerTeamRole(request, ["superadmin"]);
  if (adminAuth instanceof NextResponse) return adminAuth;

  const rl = await consume("support:start-chat", adminAuth.user.id, 30, 3600);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "You're starting chats too quickly. Please wait a moment." },
      { status: 429 },
    );
  }

  let payload: { email?: unknown };
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const email = String(payload.email ?? "").trim().toLowerCase();
  if (!email || !email.includes("@")) {
    return NextResponse.json({ error: "Pick a teammate to message." }, { status: 400 });
  }

  const admin = getSupportAdminClient();
  const workspaceId = await resolveWorkspaceId(admin, adminAuth.user.id);

  // Resolve the recipient to an auth user id — only if they are an active
  // member of THIS workspace. Cross-workspace recipients resolve to null.
  const { data: targetUserId, error: resolveErr } = await admin.rpc("resolve_workspace_member", {
    p_workspace_id: workspaceId,
    p_email: email,
  });
  if (resolveErr) {
    console.error("[support/start-chat] resolve failed:", resolveErr.message);
    return NextResponse.json({ error: "Could not start the chat. Please try again." }, { status: 500 });
  }
  if (!targetUserId || typeof targetUserId !== "string") {
    return NextResponse.json(
      { error: "That teammate has not activated their account yet, so they cannot receive a message." },
      { status: 400 },
    );
  }
  if (targetUserId === adminAuth.user.id) {
    return NextResponse.json(
      { error: "You cannot start a support chat with yourself." },
      { status: 400 },
    );
  }

  const name = await resolveUserName(admin, email);

  let thread: SupportThreadRow;
  try {
    thread = await getOrCreateChatThread({
      admin,
      workspaceId,
      ownerUserId: targetUserId,
      ownerEmail: email,
      ownerName: name,
    });
  } catch (err) {
    console.error("[support/start-chat] thread open failed:", err);
    return NextResponse.json({ error: "Could not start the chat. Please try again." }, { status: 500 });
  }

  return NextResponse.json({ thread: rowToThread(thread) });
}
