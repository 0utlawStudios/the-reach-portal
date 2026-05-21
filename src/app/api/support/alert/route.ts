// GET /api/support/alert — tiny superadmin-only unread/attention check.
// The sidebar dot uses this instead of loading the full Support Inbox.

import { NextRequest, NextResponse } from "next/server";
import { requireBearerTeamRole } from "@/lib/auth/require";
import { getSupportAdminClient, resolveWorkspaceId } from "@/lib/support/server";

export const runtime = "nodejs";
export const maxDuration = 15;

export async function GET(request: NextRequest) {
  const auth = await requireBearerTeamRole(request, ["superadmin"]);
  if (auth instanceof NextResponse) return auth;

  const admin = getSupportAdminClient();
  const workspaceId = await resolveWorkspaceId(admin, auth.user.id);

  const { data: unread, error: unreadErr } = await admin
    .from("support_threads")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("unread_for_admin", true)
    .limit(1);
  if (unreadErr) {
    console.error("[support/alert] unread check failed:", unreadErr.message);
    return NextResponse.json({ error: "Failed to check support alert" }, { status: 500 });
  }
  if ((unread || []).length > 0) return NextResponse.json({ hasAlert: true });

  const { data: untouchedOpenTickets, error: openErr } = await admin
    .from("support_threads")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("kind", "ticket")
    .eq("status", "open")
    .is("admin_last_read_at", null)
    .limit(1);
  if (openErr) {
    console.error("[support/alert] open-ticket check failed:", openErr.message);
    return NextResponse.json({ error: "Failed to check support alert" }, { status: 500 });
  }

  return NextResponse.json({ hasAlert: (untouchedOpenTickets || []).length > 0 });
}
