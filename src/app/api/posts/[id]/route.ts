// DELETE /api/posts/[id]
//
// Server-confirmed post deletion. The client must never treat a local card
// removal as authoritative until this route proves that exactly one DB row was
// deleted.

import { NextRequest, NextResponse } from "next/server";
import { requireBearerTeamRole } from "@/lib/auth/require";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { POST_DELETE_ALLOWED_ROLES } from "@/lib/roles";
import { isValidUuid } from "@/lib/utils";

export const runtime = "nodejs";
export const maxDuration = 10;

type PostDeleteRow = {
  id: string;
  title: string | null;
  stage: string | null;
  workspace_id: string;
};

const PROTECTED_DELETE_STAGES = new Set(["approved_scheduled", "posted"]);

function jsonError(error: string, status: number, code: string) {
  return NextResponse.json({ error, code }, { status });
}

export async function DELETE(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireBearerTeamRole(request, POST_DELETE_ALLOWED_ROLES);
    if (auth instanceof NextResponse) return auth;

    const { id } = await ctx.params;
    if (!isValidUuid(id)) {
      return jsonError("Invalid post id", 400, "invalid_id");
    }

    const admin = createServiceRoleClient();
    const { data: existing, error: existingError } = await admin
      .from("posts")
      .select("id, title, stage, workspace_id")
      .eq("id", id)
      .eq("workspace_id", auth.workspaceId)
      .maybeSingle<PostDeleteRow>();

    if (existingError) {
      console.error("[posts/delete] lookup failed:", existingError.message);
      return jsonError("Failed to verify post before delete", 500, "lookup_failed");
    }
    if (!existing) {
      return jsonError("Post not found", 404, "not_found");
    }
    if (existing.stage && PROTECTED_DELETE_STAGES.has(existing.stage)) {
      return jsonError(
        "This post is locked because it has been approved or posted. Move it back to Revision Needed before deleting.",
        409,
        "protected_stage",
      );
    }

    const { data: deleted, error: deleteError } = await admin
      .from("posts")
      .delete()
      .eq("id", id)
      .eq("workspace_id", auth.workspaceId)
      .select("id, title, stage, workspace_id")
      .maybeSingle<PostDeleteRow>();

    if (deleteError) {
      console.error("[posts/delete] delete failed:", deleteError.message);
      return jsonError(deleteError.message, 500, "delete_failed");
    }
    if (!deleted) {
      return jsonError("No post row was deleted. Reload and try again.", 409, "no_row_deleted");
    }

    try {
      await admin.from("audit_log_v2").insert({
        workspace_id: auth.workspaceId,
        actor_user_id: auth.user.id,
        actor_role: auth.role,
        entity_type: "post",
        entity_id: id,
        action: "post_deleted",
        metadata: {
          user_name: auth.email,
          title: existing.title,
          stage: existing.stage,
          details: `Deleted "${existing.title || id}" from The Reach Content Engine.`,
        },
      });
    } catch (err) {
      console.error("[posts/delete] audit write failed:", err);
    }

    return NextResponse.json({ success: true, data: deleted });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[posts/delete]", message);
    return jsonError(message, 500, "unknown");
  }
}
