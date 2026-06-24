import { NextRequest, NextResponse } from "next/server";
import { requireBearerTeamRole } from "@/lib/auth/require";
import { createServiceRoleClient } from "@/lib/supabase/server";
import {
  isManualPostedToggleRole,
  MANUAL_POSTED_FLAG_NAME,
  MANUAL_POSTED_READ_ROLES,
  MANUAL_POSTED_TOGGLE_ROLES,
} from "@/lib/manual-posted-constants";

export const runtime = "nodejs";
export const maxDuration = 10;

type SettingBody = {
  enabled?: unknown;
};

type FlagRow = {
  enabled: boolean | null;
};

async function readEnabled(admin: ReturnType<typeof createServiceRoleClient>, workspaceId: string): Promise<boolean> {
  const { data, error } = await admin
    .from("feature_flags")
    .select("enabled")
    .eq("workspace_id", workspaceId)
    .eq("name", MANUAL_POSTED_FLAG_NAME)
    .maybeSingle<FlagRow>();
  if (error) {
    console.error("[manual-posted-settings] flag read failed:", error.message);
    return false;
  }
  return data?.enabled === true;
}

export async function GET(request: NextRequest) {
  const auth = await requireBearerTeamRole(request, MANUAL_POSTED_READ_ROLES);
  if (auth instanceof NextResponse) return auth;

  const enabled = await readEnabled(createServiceRoleClient(), auth.workspaceId);
  return NextResponse.json(
    { enabled, canToggle: isManualPostedToggleRole(auth.role) },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function PATCH(request: NextRequest) {
  const auth = await requireBearerTeamRole(request, MANUAL_POSTED_TOGGLE_ROLES);
  if (auth instanceof NextResponse) return auth;
  if (!isManualPostedToggleRole(auth.role)) {
    return NextResponse.json({ error: "Only the superadmin can change Manual Posted moves." }, { status: 403 });
  }

  let body: SettingBody = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  if (typeof body.enabled !== "boolean") {
    return NextResponse.json({ error: "Missing boolean enabled value" }, { status: 400 });
  }

  const admin = createServiceRoleClient();
  const { error } = await admin
    .from("feature_flags")
    .upsert({
      name: MANUAL_POSTED_FLAG_NAME,
      workspace_id: auth.workspaceId,
      enabled: body.enabled,
      metadata: {
        updated_by: auth.email,
        updated_by_role: auth.role,
        updated_from: "the-reach-settings",
      },
      updated_at: new Date().toISOString(),
    }, { onConflict: "workspace_id,name" });

  if (error) {
    console.error("[manual-posted-settings] flag update failed:", error.message);
    return NextResponse.json({ error: "Failed to update Manual Posted moves" }, { status: 500 });
  }

  try {
    await admin.rpc("record_audit_event", {
      p_entity_type: "setting",
      p_action: "settings_changed",
      p_entity_id: null,
      p_workspace_id: auth.workspaceId,
      p_metadata: {
        user_name: auth.email,
        setting: MANUAL_POSTED_FLAG_NAME,
        enabled: body.enabled,
      },
    });
  } catch (err) {
    console.error("[manual-posted-settings] audit write failed:", err);
  }

  return NextResponse.json(
    { enabled: body.enabled, canToggle: true },
    { headers: { "Cache-Control": "no-store" } },
  );
}
