import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { createClient, type User } from "@supabase/supabase-js";
import { createServerSupabaseClient } from "@/lib/supabase/server";

// Server-side actor verification helpers. Route handlers call requireUser or
// requireRole at the top, get back either an AuthContext or a NextResponse
// (the 401/403 response to return directly).
//
// Part of Workstream B (B2) of the security remediation. These helpers are
// wired into the live API routes (drive, notifications, ai/studio, and more).
//
// Usage:
//
//   export async function POST(req: NextRequest) {
//     const ctx = await requireRole(req, ["superadmin", "admin"]);
//     if (ctx instanceof NextResponse) return ctx;  // 401 or 403
//     // ctx.user, ctx.workspaceId, ctx.role are now trusted
//   }

export type WorkspaceRole =
  | "superadmin"
  | "admin"
  | "owner"
  | "approver"
  | "creative_director"
  | "editor"
  | "social_media_specialist"
  | "video_editor"
  | "graphic_designer"
  | "specialist"
  | "technician"
  | "viewer";

export type AuthContext = {
  user: User;
  workspaceId: string;
  role: WorkspaceRole;
};

function unauthorized(message = "Unauthorized"): NextResponse {
  return NextResponse.json({ error: message }, { status: 401 });
}

function forbidden(message = "Forbidden"): NextResponse {
  return NextResponse.json({ error: message }, { status: 403 });
}

/**
 * Verify that the request carries a valid Supabase session cookie.
 * Returns the User on success, a 401 NextResponse on failure.
 */
export async function requireUser(
  req: NextRequest,
): Promise<{ user: User } | NextResponse> {
  try {
    const supabase = createServerSupabaseClient(req);
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) {
      return unauthorized();
    }
    return { user: data.user };
  } catch {
    return unauthorized();
  }
}

/**
 * Verify that the request carries a valid session AND the caller has an
 * active workspace_members row with one of the allowed roles. Returns the
 * full AuthContext on success, or a 401/403 NextResponse on failure.
 *
 * Depends on the workspace_members table existing (migration 0002). If the
 * table does not exist in the target database, the workspace lookup will
 * fail and the caller will get a 403, which is the correct fail-safe.
 */
export async function requireRole(
  req: NextRequest,
  allowedRoles?: readonly WorkspaceRole[],
): Promise<AuthContext | NextResponse> {
  const result = await requireUser(req);
  if (result instanceof NextResponse) return result;
  const { user } = result;

  try {
    const supabase = createServerSupabaseClient(req);
    const { data, error } = await supabase
      .from("workspace_members")
      .select("workspace_id, role")
      .eq("user_id", user.id)
      .eq("status", "active")
      .limit(1)
      .maybeSingle();

    if (error || !data) {
      return forbidden("No active workspace membership");
    }

    const role = data.role as WorkspaceRole;
    if (allowedRoles && allowedRoles.length > 0 && !allowedRoles.includes(role)) {
      return forbidden(`Role '${role}' not allowed`);
    }

    return {
      user,
      workspaceId: data.workspace_id as string,
      role,
    };
  } catch {
    return forbidden("Role check failed");
  }
}

// ─── Bearer-token variants (for client-side fetch calls with Authorization headers) ───

const TEAM_ADMIN_ROLES = new Set([
  "superadmin",
  "admin",
  "owner",
]);

/**
 * Verify Bearer token from Authorization header. Returns the authenticated User
 * or a NextResponse (401). Uses the service-role client purely to validate the
 * token — never returns it to the caller.
 */
export async function requireBearerUser(
  req: NextRequest,
): Promise<{ user: User } | NextResponse> {
  const token = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return unauthorized();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return unauthorized("Auth not configured");
  try {
    const admin = createClient(url, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data, error } = await admin.auth.getUser(token);
    if (error || !data.user) return unauthorized();
    return { user: data.user };
  } catch {
    return unauthorized();
  }
}

/**
 * Verify Bearer token + look up the caller in team_members. Returns the User
 * along with their email and role (lowercased role string for portable
 * comparison). Returns 401/403 NextResponse on failure.
 *
 * If allowedRoles is provided, the caller must have one of those roles.
 * Defaults to the team-admin set: superadmin, admin, owner.
 */
export async function requireBearerTeamRole(
  req: NextRequest,
  allowedRoles?: ReadonlyArray<string>,
): Promise<{ user: User; email: string; role: string; workspaceId: string } | NextResponse> {
  const result = await requireBearerUser(req);
  if (result instanceof NextResponse) return result;
  const { user } = result;
  const email = (user.email || "").toLowerCase();
  if (!email) return forbidden("No email on user");

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return forbidden("Auth not configured");

  try {
    const admin = createClient(url, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: workspaceMember, error: workspaceError } = await admin
      .from("workspace_members")
      .select("workspace_id, role, status")
      .eq("user_id", user.id)
      .eq("status", "active")
      .limit(1)
      .maybeSingle();

    if (workspaceError || !workspaceMember) {
      return forbidden("No active workspace membership");
    }

    // SEC-010: `.eq` not `.ilike` — the email is already lowercased above,
    // and `.ilike` would treat `%`/`_` in a crafted email as SQL wildcards.
    const { data: teamMember, error: teamError } = await admin
      .from("team_members")
      .select("role, status")
      .eq("workspace_id", workspaceMember.workspace_id)
      .eq("email", email)
      .maybeSingle();
    if (teamError || !teamMember || teamMember.status !== "active") {
      return forbidden("No active team profile");
    }

    const role = (workspaceMember.role as string) || (teamMember.role as string) || "";
    const allowed = allowedRoles
      ? new Set(allowedRoles.map((r) => r.toLowerCase()))
      : TEAM_ADMIN_ROLES;
    if (!role || !allowed.has(role.toLowerCase())) {
      return forbidden(`Role '${role || "none"}' not allowed`);
    }
    return {
      user,
      email,
      role,
      workspaceId: workspaceMember.workspace_id as string,
    };
  } catch {
    return forbidden("Role check failed");
  }
}
