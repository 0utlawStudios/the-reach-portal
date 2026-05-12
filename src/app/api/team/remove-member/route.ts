import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireBearerTeamRole } from "@/lib/auth/require";

export const maxDuration = 10;

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase admin credentials not configured");
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

interface RemoveBody {
  memberId: string;
  memberEmail: string;
  // requestedBy is no longer trusted; we derive the actor from the Bearer token.
  requestedBy?: string;
}

export async function POST(request: NextRequest) {
  try {
    // ─── Auth: verified session ───
    const ctx = await requireBearerTeamRole(request, ["superadmin", "admin", "owner"]);
    if (ctx instanceof NextResponse) return ctx;
    const actorEmail = ctx.email;

    const body: RemoveBody = await request.json();

    if (!body.memberId || !body.memberEmail) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // ─── Guard against self-removal (no one can lock themselves out) ───
    if (body.memberEmail.toLowerCase() === actorEmail) {
      return NextResponse.json({ error: "You cannot remove yourself" }, { status: 400 });
    }

    const admin = getAdminClient();

    // ─── Delete from team_members ───
    await admin.from("team_members").delete().eq("id", body.memberId);

    // ─── Delete auth user by email (paginated search) ───
    let page = 1;
    const perPage = 100;
    while (true) {
      const { data: { users }, error } = await admin.auth.admin.listUsers({ page, perPage });
      if (error || !users || users.length === 0) break;
      const found = users.find((u) => u.email?.toLowerCase() === body.memberEmail.toLowerCase());
      if (found) {
        await admin.auth.admin.deleteUser(found.id);
        break;
      }
      if (users.length < perPage) break;
      page++;
    }

    // ─── Audit log ───
    try {
      await admin.rpc("record_audit_event", {
        p_entity_type: "team",
        p_action: "member_removed",
        p_entity_id: null,
        p_metadata: { user_name: actorEmail, details: `Removed ${body.memberEmail} from team and auth` },
      });
    } catch { /* best-effort */ }

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[remove-member]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
