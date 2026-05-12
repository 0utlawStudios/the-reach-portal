import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";
import { createServerSupabaseClient } from "@/lib/supabase/server";

// Server-side actor verification helpers. Route handlers call requireUser or
// requireRole at the top, get back either an AuthContext or a NextResponse
// (the 401/403 response to return directly).
//
// Part of Workstream B (B2) of the security remediation. NOT yet wired to
// any route — this file is a scaffolding helper for future B/D/E workstreams.
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
  | "approver"
  | "creative_director"
  | "editor"
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
