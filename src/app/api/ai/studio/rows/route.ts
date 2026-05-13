// /api/ai/studio/rows
// - GET   : list rows for the caller's workspace within a date range
// - POST  : create one row

import type { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireStudioWriter, errorResponse, okResponse } from "@/lib/ai/auth-helpers";
import { resolveAspect } from "@/lib/ai/aspect-resolver";

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

const ROW_WHITELIST = [
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
] as const;

type RowWhitelistKey = (typeof ROW_WHITELIST)[number];

function filterWhitelist(body: Record<string, unknown>): Partial<Record<RowWhitelistKey, unknown>> {
  const out: Partial<Record<RowWhitelistKey, unknown>> = {};
  for (const key of ROW_WHITELIST) {
    if (key in body) out[key] = body[key];
  }
  return out;
}

function computeReadiness(row: Record<string, unknown>) {
  // Map to "ready" only if the minimum required fields are present.
  const platforms = Array.isArray(row.platforms) ? row.platforms : [];
  const required =
    row.scheduled_date && row.media_type && row.format && row.feel && row.visual_style && platforms.length > 0;
  return required ? "ready" : "empty";
}

export async function GET(req: NextRequest) {
  const ctx = await requireStudioWriter(req);
  if (!("workspaceId" in ctx)) return ctx;
  const url = new URL(req.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const sb = adminClient();
  let query = sb
    .from("content_plan_rows")
    .select("*")
    .eq("workspace_id", ctx.workspaceId)
    .order("row_index", { ascending: true });
  if (from) query = query.gte("scheduled_date", from);
  if (to) query = query.lte("scheduled_date", to);
  const { data, error } = await query;
  if (error) return errorResponse(500, error.message);
  return okResponse({ rows: data || [] });
}

export async function POST(req: NextRequest) {
  const ctx = await requireStudioWriter(req);
  if (!("workspaceId" in ctx)) return ctx;
  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return errorResponse(400, "Invalid JSON");
  }
  const filtered = filterWhitelist(body);
  const sb = adminClient();

  // Compute next row_index if caller didn't supply one.
  let rowIndex = Number(filtered.row_index);
  if (!Number.isFinite(rowIndex)) {
    const { data: last } = await sb
      .from("content_plan_rows")
      .select("row_index")
      .eq("workspace_id", ctx.workspaceId)
      .order("row_index", { ascending: false })
      .limit(1)
      .maybeSingle();
    rowIndex = (last?.row_index ?? -1) + 1;
  }

  const row: Record<string, unknown> = {
    workspace_id: ctx.workspaceId,
    created_by: ctx.email,
    row_index: rowIndex,
    ...filtered,
  };
  row.status = computeReadiness(row);
  if (row.media_type && row.format && Array.isArray(row.platforms) && (row.platforms as string[]).length > 0) {
    row.resolved_aspect = resolveAspect({
      mediaType: row.media_type as "image" | "video",
      format: row.format as never,
      platforms: row.platforms as string[],
    }).ratio;
  }

  const { data, error } = await sb.from("content_plan_rows").insert(row).select("*").single();
  if (error) return errorResponse(500, error.message);
  return okResponse({ row: data });
}
