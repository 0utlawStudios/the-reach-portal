// Shared auth helper for /api/ai/* routes. Wraps requireBearerTeamRole +
// looks up the caller's active workspace_id so every route picks the
// caller's workspace from server-derived context instead of trusting the
// request body.

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireBearerTeamRole } from "@/lib/auth/require";
import { AI_WRITER_ROLES } from "@/lib/ai/types";

const BASELINE_WORKSPACE = "00000000-0000-0000-0000-000000000001";

export interface AiAuthCtx {
  email: string;
  role: string;
  workspaceId: string;
  userId: string;
}

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase admin not configured");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

/**
 * Authenticate the request as a Studio-writer team_member, then resolve
 * the caller's active workspace_id via workspace_members.
 *
 * Returns the AiAuthCtx on success, or a 401/403 NextResponse on failure.
 */
export async function requireStudioWriter(req: NextRequest): Promise<AiAuthCtx | NextResponse> {
  const team = await requireBearerTeamRole(req, [...AI_WRITER_ROLES]);
  if (team instanceof NextResponse) return team;

  try {
    const sb = adminClient();
    const { data, error } = await sb
      .from("workspace_members")
      .select("workspace_id")
      .eq("user_id", team.user.id)
      .eq("status", "active")
      .limit(1)
      .maybeSingle();
    const workspaceId = (data?.workspace_id as string) || BASELINE_WORKSPACE;
    if (error) {
      console.error("[ai-auth] workspace lookup failed", error.message);
    }
    return {
      email: team.email,
      role: team.role,
      workspaceId,
      userId: team.user.id,
    };
  } catch (err) {
    console.error("[ai-auth] exception", err);
    return NextResponse.json({ error: "Auth lookup failed" }, { status: 500 });
  }
}

export function errorResponse(status: number, message: string, details?: unknown) {
  return NextResponse.json({ error: message, details: details ?? null }, { status });
}

export function okResponse<T>(data: T) {
  return NextResponse.json({ ok: true, data });
}
