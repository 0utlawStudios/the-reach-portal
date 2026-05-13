// Shared auth helper for /api/ai/* routes. Wraps requireBearerTeamRole +
// looks up the caller's active workspace_id so every route picks the
// caller's workspace from server-derived context instead of trusting the
// request body.
//
// Layered access model:
//   1. Bearer token must be valid + team_member role ∈ AI_WRITER_ROLES.
//   2. If brand_playbook.data.studioAllowedEmails is a non-empty array,
//      caller's email must be in it. This is the operator-managed allowlist
//      (Settings → Creator Studio access). Empty array means nobody can
//      use Studio (kill switch). Absent / null means fall back to role-only.

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { requireBearerTeamRole } from "@/lib/auth/require";
import { AI_WRITER_ROLES } from "@/lib/ai/types";
import { studioEnabled, STUDIO_DISABLED_MESSAGE } from "@/lib/ai/feature-flag";

const BASELINE_WORKSPACE = "00000000-0000-0000-0000-000000000001";

export interface AiAuthCtx {
  email: string;
  role: string;
  workspaceId: string;
  userId: string;
}

function adminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase admin not configured");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

/**
 * Fetch the Studio email allowlist from brand_playbook for a given workspace.
 *
 * Returns:
 *   - `null` when the field is absent → fall back to role-only gating
 *   - `string[]` when the field exists (may be empty) → strict allowlist mode
 */
export async function loadStudioAllowlist(
  sb: SupabaseClient,
  workspaceId: string,
): Promise<string[] | null> {
  const { data } = await sb
    .from("brand_playbook")
    .select("data")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  const raw = (data?.data as Record<string, unknown> | null)?.studioAllowedEmails;
  if (!Array.isArray(raw)) return null;
  return raw.map((v) => String(v).toLowerCase().trim()).filter(Boolean);
}

export function isEmailAllowed(email: string, allowlist: string[] | null): boolean {
  if (allowlist === null) return true; // No allowlist configured → role-only check stands.
  return allowlist.includes(email.toLowerCase().trim());
}

/**
 * Authenticate the request as a Studio-writer team_member, then resolve
 * the caller's active workspace_id via workspace_members, then check the
 * Studio email allowlist if one is configured.
 *
 * Returns the AiAuthCtx on success, or a 401/403 NextResponse on failure.
 */
export async function requireStudioWriter(req: NextRequest): Promise<AiAuthCtx | NextResponse> {
  // Feature kill switch — must come BEFORE any expensive lookup so a
  // disabled feature returns 503 in microseconds.
  if (!studioEnabled()) {
    return NextResponse.json(
      { error: STUDIO_DISABLED_MESSAGE, code: "feature_disabled" },
      { status: 503 },
    );
  }

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

    // Allowlist enforcement (defence in depth — the sidebar also hides for non-allowed users).
    const allowlist = await loadStudioAllowlist(sb, workspaceId);
    if (!isEmailAllowed(team.email, allowlist)) {
      return NextResponse.json(
        { error: "Creator Studio access is restricted. Ask an admin to add you in Settings." },
        { status: 403 },
      );
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
