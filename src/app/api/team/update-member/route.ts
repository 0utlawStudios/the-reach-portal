import { NextRequest, NextResponse } from "next/server";
import { createClient, type User } from "@supabase/supabase-js";
import { requireBearerTeamRole } from "@/lib/auth/require";

export const maxDuration = 10;

const ADMIN_ROLES = new Set(["superadmin", "admin", "owner"]);
const VALID_ROLES = new Set([
  "superadmin",
  "admin",
  "approver",
  "creative_director",
  "social_media_specialist",
  "video_editor",
  "graphic_designer",
]);

type AdminClient = ReturnType<typeof getAdminClient>;
type TeamMemberRow = {
  id: string;
  name: string;
  email: string;
  phone?: string | null;
  role: string;
  status: "active" | "pending";
  avatar_url?: string | null;
};

type ProfileUpdates = {
  name?: string;
  phone?: string | null;
  avatar?: string | null;
  role?: string;
};

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase admin credentials not configured");
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

async function findAuthUserByEmail(admin: AdminClient, email: string): Promise<User | null> {
  let page = 1;
  const perPage = 100;
  while (true) {
    const { data: { users }, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error || !users || users.length === 0) break;
    const found = users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (found) return found;
    if (users.length < perPage) break;
    page++;
  }
  return null;
}

function cleanUpdates(input: unknown): ProfileUpdates {
  const raw = (input || {}) as Record<string, unknown>;
  const updates: ProfileUpdates = {};
  if (typeof raw.name === "string") updates.name = raw.name.trim();
  if (typeof raw.phone === "string") updates.phone = raw.phone.trim() || null;
  if (raw.phone === null) updates.phone = null;
  if (typeof raw.avatar === "string") updates.avatar = raw.avatar.trim() || null;
  if (raw.avatar === null) updates.avatar = null;
  if (typeof raw.role === "string") updates.role = raw.role.trim();
  return updates;
}

function toDbUpdates(updates: ProfileUpdates) {
  const dbUpdates: Record<string, unknown> = {};
  if (updates.name !== undefined) dbUpdates.name = updates.name;
  if (updates.phone !== undefined) dbUpdates.phone = updates.phone;
  if (updates.avatar !== undefined) dbUpdates.avatar_url = updates.avatar;
  if (updates.role !== undefined) dbUpdates.role = updates.role;
  return dbUpdates;
}

async function auditUpdate(admin: AdminClient, actorEmail: string, target: TeamMemberRow, updates: ProfileUpdates, roleChanged: boolean) {
  try {
    await admin.rpc("record_audit_event", {
      p_entity_type: "team",
      p_action: roleChanged ? "role_changed" : "member_profile_updated",
      p_entity_id: null,
      p_metadata: {
        user_name: actorEmail,
        details: roleChanged
          ? `Changed ${target.name}'s role from ${target.role} to ${updates.role}`
          : `Updated profile for ${target.name}`,
      },
    });
  } catch {
    // Best-effort; profile/workspace reconciliation is authoritative.
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireBearerTeamRole(request, ["superadmin", "admin", "owner"]);
    if (ctx instanceof NextResponse) return ctx;
    if (!ADMIN_ROLES.has(ctx.role.toLowerCase())) {
      return NextResponse.json({ error: "Admin role required" }, { status: 403 });
    }

    const body = await request.json();
    const memberId = String(body.memberId || "").trim();
    const updates = cleanUpdates(body.updates);
    if (!memberId) return NextResponse.json({ error: "Missing memberId" }, { status: 400 });

    if (updates.name !== undefined && !updates.name) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }
    if (updates.role !== undefined && !VALID_ROLES.has(updates.role)) {
      return NextResponse.json({ error: "Invalid role" }, { status: 400 });
    }
    if (updates.role === "superadmin" && ctx.role !== "superadmin") {
      return NextResponse.json({ error: "Only a superadmin can assign superadmin" }, { status: 403 });
    }

    const dbUpdates = toDbUpdates(updates);
    if (Object.keys(dbUpdates).length === 0) {
      return NextResponse.json({ success: true, unchanged: true });
    }

    const admin = getAdminClient();
    const { data: member, error: readErr } = await admin
      .from("team_members")
      .select("id, name, email, phone, role, status, avatar_url")
      .eq("id", memberId)
      .maybeSingle();
    if (readErr) return NextResponse.json({ error: "Could not read team member" }, { status: 500 });
    if (!member) return NextResponse.json({ error: "Team member not found" }, { status: 404 });

    const target = member as TeamMemberRow;
    if (target.role === "superadmin" && ctx.role !== "superadmin") {
      return NextResponse.json({ error: "Only a superadmin can edit a superadmin" }, { status: 403 });
    }

    const roleChanged = updates.role !== undefined && updates.role !== target.role;
    const authUser = await findAuthUserByEmail(admin, target.email);
    if (target.status === "active" && roleChanged && !authUser) {
      return NextResponse.json({ error: "Active member is missing a matching auth user" }, { status: 409 });
    }

    const rollbackTeam = {
      name: target.name,
      phone: target.phone || null,
      role: target.role,
      avatar_url: target.avatar_url || null,
    };

    const { error: updateErr } = await admin
      .from("team_members")
      .update(dbUpdates)
      .eq("id", target.id);
    if (updateErr) {
      return NextResponse.json({ error: "Team profile update failed" }, { status: 500 });
    }

    if (roleChanged && authUser?.id && target.status === "active") {
      const { error: workspaceErr } = await admin
        .from("workspace_members")
        .update({ role: updates.role })
        .eq("workspace_id", ctx.workspaceId)
        .eq("user_id", authUser.id);
      if (workspaceErr) {
        await admin.from("team_members").update(rollbackTeam).eq("id", target.id);
        return NextResponse.json({ error: "Workspace role update failed; team profile was rolled back." }, { status: 500 });
      }
    }

    if (authUser?.id) {
      const nextMetadata = {
        ...(authUser.user_metadata || {}),
        ...(updates.name !== undefined ? { name: updates.name } : {}),
        ...(updates.phone !== undefined ? { phone: updates.phone } : {}),
        ...(updates.avatar !== undefined ? { avatar_url: updates.avatar } : {}),
        ...(updates.role !== undefined ? { role: updates.role } : {}),
      };
      const { error: authErr } = await admin.auth.admin.updateUserById(authUser.id, {
        user_metadata: nextMetadata,
      });
      if (authErr) {
        await admin.from("team_members").update(rollbackTeam).eq("id", target.id);
        if (roleChanged && target.status === "active") {
          await admin.from("workspace_members").update({ role: target.role }).eq("workspace_id", ctx.workspaceId).eq("user_id", authUser.id);
        }
        return NextResponse.json({ error: "Auth metadata update failed; profile was rolled back." }, { status: 500 });
      }
    }

    await auditUpdate(admin, ctx.email, target, updates, roleChanged);
    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[team/update-member]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
