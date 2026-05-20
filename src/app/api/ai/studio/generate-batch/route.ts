// POST /api/ai/studio/generate-batch — enqueue multiple plan rows at once.
// Body: { row_ids: uuid[] }
// Worker processes them serially via the same cron pipeline.

import type { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireStudioWriter, errorResponse, okResponse } from "@/lib/ai/auth-helpers";
import { consume, getClientIp } from "@/lib/rate-limit";
import { enforceDailyCap, DailyCapExceeded } from "@/lib/ai/cost";
import { resolveAspect } from "@/lib/ai/aspect-resolver";

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function isValidUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

export async function POST(req: NextRequest) {
  const ctx = await requireStudioWriter(req);
  if (!("workspaceId" in ctx)) return ctx;

  let body: { row_ids?: string[] } = {};
  try {
    body = (await req.json()) as { row_ids?: string[] };
  } catch {
    return errorResponse(400, "Invalid JSON");
  }
  const ids = Array.isArray(body.row_ids) ? body.row_ids.filter(isValidUuid).slice(0, 14) : [];
  if (ids.length === 0) return errorResponse(400, "row_ids required");

  // Use a single rate-limit budget across the batch — one token per row.
  for (let i = 0; i < ids.length; i++) {
    const rl = await consume(`ai-generate:${ctx.workspaceId}`, `user:${ctx.userId}|ip:${getClientIp(req)}`, 30, 3600);
    if (!rl.allowed) return errorResponse(429, `Rate limit reached after ${i} rows. Try again in an hour.`);
  }

  try {
    await enforceDailyCap(ctx.workspaceId);
  } catch (err) {
    if (err instanceof DailyCapExceeded) return errorResponse(429, err.message);
    return errorResponse(500, err instanceof Error ? err.message : "Cap check failed");
  }

  const sb = adminClient();
  const { data: rows, error: rowsErr } = await sb
    .from("content_plan_rows")
    .select("*")
    .in("id", ids)
    .eq("workspace_id", ctx.workspaceId);
  if (rowsErr) {
    console.error("[ai/studio/generate-batch] rows fetch failed:", rowsErr.message);
    return errorResponse(500, "Could not load plan rows");
  }
  const usableRows = (rows || []).filter((r) => r.status === "ready" || r.status === "empty" || r.status === "failed");
  if (usableRows.length === 0) return errorResponse(400, "No rows are ready to generate");

  const enqueued: { row_id: string; job_id: string }[] = [];
  for (const row of usableRows) {
    if (!row.media_type || !row.format || !row.feel || !row.visual_style || !(row.platforms || []).length) continue;
    const resolved = resolveAspect({
      mediaType: row.media_type,
      format: row.format,
      platforms: row.platforms,
    });
    const { data: job } = await sb
      .from("ai_generation_jobs")
      .insert({
        workspace_id: ctx.workspaceId,
        kind: "generate",
        status: "queued",
        plan_row_id: row.id,
        requested_by: ctx.email,
        payload: { resolved },
      })
      .select("id")
      .single();
    if (job?.id) {
      await sb
        .from("content_plan_rows")
        .update({ status: "generating", resolved_aspect: resolved.ratio, last_error: null })
        .eq("id", row.id);
      enqueued.push({ row_id: row.id, job_id: job.id });
    }
  }

  // Kick the worker.
  const secret = process.env.AI_WORKER_TRIGGER_SECRET || process.env.CRON_SECRET;
  if (secret) {
    void fetch(`${req.nextUrl.origin}/api/ai/auto-revise/process`, {
      method: "POST",
      headers: { "x-trigger-secret": secret },
    }).catch(() => {});
  }

  return okResponse({ enqueued, total: enqueued.length });
}
