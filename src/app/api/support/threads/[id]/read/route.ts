// POST /api/support/threads/[id]/read — clear the unread flag for the caller.
// The thread owner clears their own flag; the superadmin clears the admin flag.

import { NextRequest, NextResponse } from "next/server";
import { isValidUuid } from "@/lib/utils";
import { requireBearerUser } from "@/lib/auth/require";
import { getSupportAdminClient, getTeamRole } from "@/lib/support/server";

export const runtime = "nodejs";
export const maxDuration = 15;

export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireBearerUser(request);
  if (auth instanceof NextResponse) return auth;
  const { id } = await ctx.params;
  if (!isValidUuid(id)) return NextResponse.json({ error: "Invalid thread id" }, { status: 400 });

  const admin = getSupportAdminClient();
  const { data: threadRow, error } = await admin
    .from("support_threads")
    .select("id, created_by")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    console.error("[support/read] load failed:", error.message);
    return NextResponse.json({ error: "Failed to update" }, { status: 500 });
  }
  if (!threadRow) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const isOwner = (threadRow as { created_by: string | null }).created_by === auth.user.id;
  if (isOwner) {
    await admin.from("support_threads").update({ unread_for_user: false }).eq("id", id);
    return NextResponse.json({ ok: true });
  }

  const role = await getTeamRole(admin, auth.user.email ?? "");
  if (role !== "superadmin") return NextResponse.json({ error: "Not found" }, { status: 404 });
  await admin.from("support_threads").update({ unread_for_admin: false }).eq("id", id);
  return NextResponse.json({ ok: true });
}
