// POST /api/ai/studio/cancel-job/[id] — cancel a queued job. Running jobs
// cannot be aborted reliably (image generation cannot be cancelled mid-flight)
// so we refuse the cancel if status !== 'queued'.

import type { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireStudioWriter, errorResponse, okResponse } from "@/lib/ai/auth-helpers";

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function isValidUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

export async function POST(req: NextRequest, ctxParams: { params: Promise<{ id: string }> }) {
  const ctx = await requireStudioWriter(req);
  if (!("workspaceId" in ctx)) return ctx;
  const { id } = await ctxParams.params;
  if (!isValidUuid(id)) return errorResponse(400, "Invalid job id");

  const sb = adminClient();
  const { data: job, error: getErr } = await sb
    .from("ai_generation_jobs")
    .select("id, status, plan_row_id, workspace_id")
    .eq("id", id)
    .eq("workspace_id", ctx.workspaceId)
    .maybeSingle();
  if (getErr) return errorResponse(500, getErr.message);
  if (!job) return errorResponse(404, "Job not found");
  if (job.status !== "queued") return errorResponse(409, `Cannot cancel job in status '${job.status}'`);

  const { error } = await sb
    .from("ai_generation_jobs")
    .update({ status: "cancelled", completed_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return errorResponse(500, error.message);
  if (job.plan_row_id) {
    await sb.from("content_plan_rows").update({ status: "ready", last_error: null }).eq("id", job.plan_row_id);
  }
  return okResponse({ cancelled: true });
}
