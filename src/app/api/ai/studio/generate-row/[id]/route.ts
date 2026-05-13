// POST /api/ai/studio/generate-row/[id] — enqueue a generate job for one row.
//
// Path is fire-and-poll: this endpoint validates, enforces the daily cap,
// rate-limits per user, inserts an ai_generation_jobs row in 'queued' state,
// flips the plan row to 'generating', and returns the job_id. The actual
// pipeline runs inside POST /api/ai/auto-revise/process (the Vercel cron
// worker, which handles both generate + revise queues).

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

function brandIsPlaceholder(data: Record<string, unknown> | null | undefined): boolean {
  if (!data) return true;
  const s = JSON.stringify(data);
  return /Sample hook 1|Define your brand voice|placeholder/i.test(s);
}

export async function POST(req: NextRequest, ctxParams: { params: Promise<{ id: string }> }) {
  const ctx = await requireStudioWriter(req);
  if (!("workspaceId" in ctx)) return ctx;

  // Per-user 30/hour rate limit.
  const rl = await consume(`ai-generate:${ctx.workspaceId}`, `user:${ctx.userId}|ip:${getClientIp(req)}`, 30, 3600);
  if (!rl.allowed) {
    return errorResponse(429, "Generation rate limit reached. Try again in an hour.");
  }

  try {
    await enforceDailyCap(ctx.workspaceId);
  } catch (err) {
    if (err instanceof DailyCapExceeded) return errorResponse(429, err.message);
    return errorResponse(500, err instanceof Error ? err.message : "Cap check failed");
  }

  const { id } = await ctxParams.params;
  if (!isValidUuid(id)) return errorResponse(400, "Invalid row id");

  const sb = adminClient();
  const { data: row, error: rowErr } = await sb
    .from("content_plan_rows")
    .select("*")
    .eq("id", id)
    .eq("workspace_id", ctx.workspaceId)
    .maybeSingle();
  if (rowErr) return errorResponse(500, rowErr.message);
  if (!row) return errorResponse(404, "Row not found");
  if (row.status === "generating" || row.status === "revising") {
    return errorResponse(409, "Row already in flight");
  }
  if (!row.media_type || !row.format || !row.feel || !row.visual_style || !(row.platforms || []).length) {
    return errorResponse(400, "Row is missing required fields");
  }

  // Re-resolve the aspect ratio on the server — defends against a tampered client.
  const resolved = resolveAspect({
    mediaType: row.media_type,
    format: row.format,
    platforms: row.platforms,
  });

  // Refuse to generate if the brand_playbook is still placeholder.
  const { data: brand } = await sb
    .from("brand_playbook")
    .select("data")
    .eq("workspace_id", ctx.workspaceId)
    .maybeSingle();
  if (brandIsPlaceholder(brand?.data as Record<string, unknown>)) {
    return errorResponse(503, "Fill in the Brand Kit before generating AI drafts.");
  }

  const { data: job, error: jobErr } = await sb
    .from("ai_generation_jobs")
    .insert({
      workspace_id: ctx.workspaceId,
      kind: "generate",
      status: "queued",
      plan_row_id: row.id,
      requested_by: ctx.email,
      payload: { resolved },
    })
    .select("*")
    .single();
  if (jobErr || !job) return errorResponse(500, jobErr?.message || "Failed to enqueue");

  await sb
    .from("content_plan_rows")
    .update({ status: "generating", resolved_aspect: resolved.ratio, last_error: null })
    .eq("id", id)
    .eq("workspace_id", ctx.workspaceId);

  // Trigger the worker out-of-band so the row picks up quickly without
  // waiting for the 1-minute cron. We fire-and-forget on the same host.
  void triggerWorker(req).catch((err) => console.error("[generate-row] trigger worker failed", err));

  return okResponse({ job });
}

async function triggerWorker(req: NextRequest) {
  const base = req.nextUrl.origin;
  const secret = process.env.AI_WORKER_TRIGGER_SECRET || process.env.CRON_SECRET;
  if (!secret) return;
  try {
    await fetch(`${base}/api/ai/auto-revise/process`, {
      method: "POST",
      headers: { "x-trigger-secret": secret },
    });
  } catch {
    // Best-effort — cron will catch it in <=60s if this fails.
  }
}
