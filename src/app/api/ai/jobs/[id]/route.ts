// GET /api/ai/jobs/[id] — poll a job's status for the Studio UI.

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

export async function GET(req: NextRequest, ctxParams: { params: Promise<{ id: string }> }) {
  const ctx = await requireStudioWriter(req);
  if (!("workspaceId" in ctx)) return ctx;
  const { id } = await ctxParams.params;
  if (!isValidUuid(id)) return errorResponse(400, "Invalid job id");

  const sb = adminClient();
  const { data, error } = await sb
    .from("ai_generation_jobs")
    .select("id, kind, status, plan_row_id, post_id, error, cost_usd, created_at, completed_at")
    .eq("id", id)
    .eq("workspace_id", ctx.workspaceId)
    .maybeSingle();
  if (error) return errorResponse(500, error.message);
  if (!data) return errorResponse(404, "Job not found");
  return okResponse({ job: data });
}
