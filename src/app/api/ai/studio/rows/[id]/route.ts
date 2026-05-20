// /api/ai/studio/rows/[id]
// - PATCH  : partial update of a plan row (whitelist of fields)
// - DELETE : delete (only if status is empty/ready/failed)

import type { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireStudioWriter, errorResponse, okResponse } from "@/lib/ai/auth-helpers";
import { resolveAspect } from "@/lib/ai/aspect-resolver";

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function isValidUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

const EDITABLE = new Set([
  "row_index",
  "scheduled_date",
  "scheduled_time",
  "platforms",
  "media_type",
  "format",
  "slides_count",
  "feel",
  "visual_style",
  "style_prompt",
  "topic",
  "notes",
]);

export async function PATCH(req: NextRequest, ctxParams: { params: Promise<{ id: string }> }) {
  const ctx = await requireStudioWriter(req);
  if (!("workspaceId" in ctx)) return ctx;
  const { id } = await ctxParams.params;
  if (!isValidUuid(id)) return errorResponse(400, "Invalid row id");

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return errorResponse(400, "Invalid JSON");
  }

  const update: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    if (EDITABLE.has(k)) update[k] = v;
  }
  if (Object.keys(update).length === 0) return errorResponse(400, "Nothing to update");

  const sb = adminClient();
  const { data: current, error: getErr } = await sb
    .from("content_plan_rows")
    .select("*")
    .eq("id", id)
    .eq("workspace_id", ctx.workspaceId)
    .maybeSingle();
  // SEC-011: log the raw PostgREST error, return a generic message.
  if (getErr) {
    console.error("[studio-rows/:id] lookup failed", getErr);
    return errorResponse(500, "Failed to load plan row");
  }
  if (!current) return errorResponse(404, "Row not found");

  // Once a row is generated/generating/revising the editable surface is locked.
  if (current.status === "generating" || current.status === "revising") {
    return errorResponse(409, "Row is generating, edits blocked until completion");
  }
  if (current.status === "generated") {
    return errorResponse(409, "Row has been generated; edits would not affect the post");
  }

  const merged = { ...current, ...update };
  // Recompute readiness + resolved_aspect from the merged row.
  const platforms = Array.isArray(merged.platforms) ? merged.platforms : [];
  const ready =
    merged.scheduled_date && merged.media_type && merged.format && merged.feel && merged.visual_style && platforms.length > 0;
  update.status = ready ? "ready" : "empty";
  if (merged.media_type && merged.format && platforms.length > 0) {
    update.resolved_aspect = resolveAspect({
      mediaType: merged.media_type as "image" | "video",
      format: merged.format as never,
      platforms,
    }).ratio;
  } else {
    update.resolved_aspect = null;
  }

  const { data, error } = await sb
    .from("content_plan_rows")
    .update(update)
    .eq("id", id)
    .eq("workspace_id", ctx.workspaceId)
    .select("*")
    .single();
  // SEC-011: log the raw PostgREST error, return a generic message.
  if (error) {
    console.error("[studio-rows/:id] update failed", error);
    return errorResponse(500, "Failed to update plan row");
  }
  return okResponse({ row: data });
}

export async function DELETE(req: NextRequest, ctxParams: { params: Promise<{ id: string }> }) {
  const ctx = await requireStudioWriter(req);
  if (!("workspaceId" in ctx)) return ctx;
  const { id } = await ctxParams.params;
  if (!isValidUuid(id)) return errorResponse(400, "Invalid row id");

  const sb = adminClient();
  const { data: row, error: getErr } = await sb
    .from("content_plan_rows")
    .select("status")
    .eq("id", id)
    .eq("workspace_id", ctx.workspaceId)
    .maybeSingle();
  // SEC-011: log the raw PostgREST error, return a generic message.
  if (getErr) {
    console.error("[studio-rows/:id] delete lookup failed", getErr);
    return errorResponse(500, "Failed to load plan row");
  }
  if (!row) return errorResponse(404, "Row not found");
  if (row.status === "generating" || row.status === "revising") {
    return errorResponse(409, "Row is generating, delete blocked");
  }

  const { error } = await sb.from("content_plan_rows").delete().eq("id", id).eq("workspace_id", ctx.workspaceId);
  // SEC-011: log the raw PostgREST error, return a generic message.
  if (error) {
    console.error("[studio-rows/:id] delete failed", error);
    return errorResponse(500, "Failed to delete plan row");
  }
  return okResponse({ deleted: true });
}
