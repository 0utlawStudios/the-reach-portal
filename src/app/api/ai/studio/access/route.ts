// GET  /api/ai/studio/access — returns the caller's access state.
// PUT  /api/ai/studio/access — admin-only edit of the email allowlist.
//
// Non-admins get a "single bit" answer: `{ allowed: boolean }`. Admins
// additionally get the full allowlist so they can render the Settings panel.

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { requireBearerTeamRole } from "@/lib/auth/require";
import { loadStudioAllowlist, isEmailAllowed, errorResponse, okResponse } from "@/lib/ai/auth-helpers";
import { studioEnabled } from "@/lib/ai/feature-flag";

const BASELINE_WORKSPACE = "00000000-0000-0000-0000-000000000001";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ADMIN_ROLES = ["superadmin", "admin", "owner"];

function adminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function resolveWorkspace(sb: SupabaseClient, userId: string): Promise<string> {
  const { data } = await sb
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", userId)
    .eq("status", "active")
    .limit(1)
    .maybeSingle();
  return (data?.workspace_id as string) || BASELINE_WORKSPACE;
}

export async function GET(req: NextRequest) {
  // Any active team member can ask "am I allowed?". Use the broadest possible
  // role gate so non-writer roles still get a clean false answer.
  const team = await requireBearerTeamRole(req, [
    "superadmin",
    "admin",
    "owner",
    "creative_director",
    "social_media_specialist",
    "approver",
    "editor",
    "viewer",
    "video_editor",
    "graphic_designer",
    "specialist",
    "technician",
  ]);
  if (team instanceof NextResponse) return team;

  // If the feature is disabled, return a clean "not allowed + reason" so
  // the sidebar can render the disabled state instead of leaking errors.
  if (!studioEnabled()) {
    return okResponse({
      allowed: false,
      isAdmin: ADMIN_ROLES.includes(team.role.toLowerCase()),
      allowlist: null,
      allowlistConfigured: false,
      reason: "feature_disabled",
    });
  }

  const sb = adminClient();
  const workspaceId = await resolveWorkspace(sb, team.user.id);
  const allowlist = await loadStudioAllowlist(sb, workspaceId);
  const allowed = isEmailAllowed(team.email, allowlist);
  const isAdmin = ADMIN_ROLES.includes(team.role.toLowerCase());

  return okResponse({
    allowed,
    isAdmin,
    // Admins see the live allowlist so the Settings panel can render.
    allowlist: isAdmin ? (allowlist ?? []) : null,
    allowlistConfigured: allowlist !== null,
  });
}

export async function PUT(req: NextRequest) {
  // Only superadmin / admin / owner can edit the allowlist.
  const team = await requireBearerTeamRole(req, ADMIN_ROLES);
  if (team instanceof NextResponse) return team;
  // Allow allowlist edits even when the feature is disabled — admins should
  // be able to prep access for re-enable. The feature flag gates GENERATION,
  // not configuration.

  let body: { emails?: unknown; mode?: unknown } = {};
  try { body = (await req.json()) as typeof body; } catch { return errorResponse(400, "Invalid JSON"); }

  const mode = body.mode === "clear" ? "clear" : "set";
  let normalized: string[] = [];
  if (mode === "set") {
    if (!Array.isArray(body.emails)) return errorResponse(400, "emails must be an array");
    const cleaned = (body.emails as unknown[])
      .map((v) => String(v ?? "").toLowerCase().trim())
      .filter((v) => v.length > 0);
    for (const e of cleaned) {
      if (!EMAIL_RE.test(e)) return errorResponse(400, `Invalid email: ${e}`);
    }
    // Dedupe.
    normalized = Array.from(new Set(cleaned));
  }

  const sb = adminClient();
  const workspaceId = await resolveWorkspace(sb, team.user.id);

  // Pull current data, merge, write back.
  const { data: current, error: getErr } = await sb
    .from("brand_playbook")
    .select("id, data")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (getErr) return errorResponse(500, getErr.message);
  if (!current) return errorResponse(404, "Brand playbook row not found for this workspace");

  const data = { ...(current.data as Record<string, unknown> || {}) };
  if (mode === "clear") {
    delete data.studioAllowedEmails;
  } else {
    data.studioAllowedEmails = normalized;
  }

  const { error: upErr } = await sb
    .from("brand_playbook")
    .update({ data })
    .eq("id", current.id);
  if (upErr) return errorResponse(500, upErr.message);

  // Audit
  try {
    await sb.rpc("record_audit_event", {
      p_entity_type: "settings",
      p_action: "studio_access_updated",
      p_entity_id: null,
      p_metadata: {
        actor_email: team.email,
        mode,
        emails: mode === "set" ? normalized : null,
      },
    });
  } catch (err) {
    console.error("[studio-access] audit failed", err);
  }

  return okResponse({
    allowlist: mode === "set" ? normalized : null,
    allowlistConfigured: mode === "set",
  });
}
