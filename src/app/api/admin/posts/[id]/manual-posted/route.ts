// POST /api/admin/posts/[id]/manual-posted
//
// Emergency/manual confirmation path for cases where Meta or the auto-publisher
// is blocked but an approver-class operator has verified the content is live.
// Browser clients cannot update stage='posted' directly; migration 0046 blocks
// that. This route verifies the admin-class actor, then uses the service-role
// client and records posted_at in the same write.

import { NextRequest, NextResponse } from "next/server";
import { requireBearerTeamRole } from "@/lib/auth/require";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { isValidUuid } from "@/lib/utils";
import { MANUAL_POSTED_FLAG_NAME, MANUAL_POSTED_MOVE_ROLES } from "@/lib/manual-posted-constants";

export const runtime = "nodejs";
export const maxDuration = 10;

type ManualPostedBody = {
  postedAt?: unknown;
};

function parsePostedAt(value: unknown): string {
  if (typeof value === "string" && !Number.isNaN(Date.parse(value))) {
    return new Date(value).toISOString();
  }
  return new Date().toISOString();
}

export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireBearerTeamRole(request, MANUAL_POSTED_MOVE_ROLES);
    if (auth instanceof NextResponse) return auth;

    const { id } = await ctx.params;
    if (!isValidUuid(id)) {
      return NextResponse.json({ error: "Invalid post id" }, { status: 400 });
    }

    let body: ManualPostedBody = {};
    try {
      body = await request.json();
    } catch {
      body = {};
    }

    const postedAt = parsePostedAt(body.postedAt);
    const admin = createServiceRoleClient();
    const { data: flag, error: flagError } = await admin
      .from("feature_flags")
      .select("enabled")
      .eq("workspace_id", auth.workspaceId)
      .eq("name", MANUAL_POSTED_FLAG_NAME)
      .maybeSingle<{ enabled: boolean | null }>();
    if (flagError) {
      console.error("[admin/posts/manual-posted] flag read failed:", flagError.message);
      return NextResponse.json({ error: "Could not verify Manual Posted setting" }, { status: 500 });
    }
    if (flag?.enabled !== true) {
      return NextResponse.json({ error: "Manual Posted moves are disabled in Settings." }, { status: 403 });
    }

    const { data: existing, error: existingError } = await admin
      .from("posts")
      .select("id, title, stage, workspace_id, posted_at")
      .eq("id", id)
      .eq("workspace_id", auth.workspaceId)
      .maybeSingle();

    if (existingError) {
      console.error("[admin/posts/manual-posted] lookup failed:", existingError.message);
      return NextResponse.json({ error: "Failed to verify post" }, { status: 500 });
    }
    if (!existing) {
      return NextResponse.json({ error: "Post not found" }, { status: 404 });
    }

    if (existing.stage === "posted") {
      return NextResponse.json({ success: true, data: { id, stage: "posted", posted_at: existing.posted_at || postedAt } });
    }
    if (existing.stage !== "approved_scheduled") {
      return NextResponse.json({ error: "Only Approved / Scheduled posts can be manually moved to Posted." }, { status: 409 });
    }

    const { data, error } = await admin
      .from("posts")
      .update({ stage: "posted", posted_at: postedAt })
      .eq("id", id)
      .eq("workspace_id", auth.workspaceId)
      .select("id, stage, posted_at")
      .maybeSingle();

    if (error) {
      console.error("[admin/posts/manual-posted] update failed:", error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ error: "Post not found" }, { status: 404 });
    }

    try {
      await admin.rpc("record_audit_event", {
        p_entity_type: "post",
        p_action: "manual_posted",
        p_entity_id: id,
        p_workspace_id: auth.workspaceId,
        p_metadata: {
          user_name: auth.email,
          details: `Manually moved "${existing.title || id}" to Posted from The Reach settings override.`,
          previous_stage: existing.stage,
          posted_at: postedAt,
        },
      });
    } catch (err) {
      console.error("[admin/posts/manual-posted] audit write failed:", err);
    }

    return NextResponse.json({ success: true, data });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[admin/posts/manual-posted]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
