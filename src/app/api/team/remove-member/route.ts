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

type AdminClient = ReturnType<typeof getAdminClient>;

/** Find an existing auth user by email using paginated listUsers. */
async function findAuthUserByEmail(admin: AdminClient, email: string) {
  let page = 1;
  const perPage = 100;
  while (true) {
    const { data: { users }, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw new Error(`Auth lookup failed: ${error.message}`);
    if (!users || users.length === 0) return null;
    const found = users.find((u) => u.email?.toLowerCase() === email);
    if (found) return found;
    if (users.length < perPage) return null;
    page++;
  }
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

    const memberEmail = body.memberEmail.trim().toLowerCase();

    const admin = getAdminClient();
    const { data: targetMember, error: targetErr } = await admin
      .from("team_members")
      .select("id, email")
      .eq("id", body.memberId)
      .maybeSingle();
    if (targetErr) {
      throw new Error(`Team member lookup failed: ${targetErr.message}`);
    }
    if (!targetMember) {
      return NextResponse.json({ error: "Member not found" }, { status: 404 });
    }

    const targetEmail = String(targetMember.email || "").trim().toLowerCase();
    if (targetEmail !== memberEmail) {
      return NextResponse.json({ error: "Member id/email mismatch" }, { status: 409 });
    }

    // ─── Guard against self-removal (no one can lock themselves out) ───
    if (targetEmail === actorEmail) {
      return NextResponse.json({ error: "You cannot remove yourself" }, { status: 400 });
    }

    const authUser = await findAuthUserByEmail(admin, targetEmail);

    // Remove active/pending workspace access before removing the profile row.
    // This makes the revoke immediate even if the auth user cleanup has to be
    // retried later by the invite route's orphan-user cleanup.
    if (authUser?.id) {
      const { error: workspaceDeleteErr } = await admin
        .from("workspace_members")
        .delete()
        .eq("user_id", authUser.id);
      if (workspaceDeleteErr) {
        throw new Error(`Workspace membership cleanup failed: ${workspaceDeleteErr.message}`);
      }
    }

    // Delete from team_members by both id and email. The id keeps the common
    // path precise; the email cleanup makes the route idempotent when the UI
    // has a stale row id after a realtime race.
    const { error: teamDeleteErr } = await admin
      .from("team_members")
      .delete()
      .eq("id", body.memberId)
      .eq("email", targetEmail);
    if (teamDeleteErr) {
      throw new Error(`Team profile cleanup failed: ${teamDeleteErr.message}`);
    }

    let authDeleted = false;
    let authCleanupError: string | null = null;
    if (authUser?.id) {
      const { error: authDeleteErr } = await admin.auth.admin.deleteUser(authUser.id);
      if (authDeleteErr) {
        authCleanupError = authDeleteErr.message;
        console.error("[remove-member] auth user cleanup failed after access revoke:", authDeleteErr.message);
      } else {
        authDeleted = true;
      }
    }

    // ─── Audit log ───
    try {
      await admin.rpc("record_audit_event", {
        p_entity_type: "team",
        p_action: "member_removed",
        p_entity_id: null,
        p_metadata: {
          user_name: actorEmail,
          details: authCleanupError
            ? `Removed ${targetEmail} from team and workspace access; auth cleanup needs retry: ${authCleanupError}`
            : `Removed ${targetEmail} from team, workspace access, and auth`,
        },
      });
    } catch { /* best-effort */ }

    return NextResponse.json({
      success: true,
      authDeleted,
      authCleanupPending: Boolean(authCleanupError),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[remove-member]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
