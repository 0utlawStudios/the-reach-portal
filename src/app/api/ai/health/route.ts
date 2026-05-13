// GET /api/ai/health — operational dashboard data for Creator Studio.
//
// Admin-only. Returns a single JSON blob with everything you'd want on a
// 30-second glance at the system's state. Used by the Settings panel and
// by any external monitoring (cron-pinger that emails if numbers drift).

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { requireBearerTeamRole } from "@/lib/auth/require";
import { dailyCapUsd, todaysSpend, perRowCapUsd } from "@/lib/ai/cost";
import { studioEnabled } from "@/lib/ai/feature-flag";
import { okResponse } from "@/lib/ai/auth-helpers";

const BASELINE_WORKSPACE = "00000000-0000-0000-0000-000000000001";
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
  const team = await requireBearerTeamRole(req, ADMIN_ROLES);
  if (team instanceof NextResponse) return team;

  const sb = adminClient();
  const workspaceId = await resolveWorkspace(sb, team.user.id);

  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const stuckCutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString();

  // All counters scope to the caller's workspace via the same RLS contract
  // the rest of the app uses. Service role bypasses RLS so we filter manually.
  const [
    todays,
    spend24h,
    queuedCount,
    runningCount,
    failed24h,
    completed24h,
    stuckJobs,
    capHits7d,
    gateFailures7d,
    avgLatency24h,
  ] = await Promise.all([
    todaysSpend(workspaceId),
    sumCost(sb, workspaceId, since24h),
    countByStatus(sb, workspaceId, "queued"),
    countByStatus(sb, workspaceId, "running"),
    countWithStatusSince(sb, workspaceId, "failed", since24h),
    countWithStatusSince(sb, workspaceId, "completed", since24h),
    sb.from("ai_generation_jobs")
      .select("id, started_at", { count: "exact", head: false })
      .eq("workspace_id", workspaceId)
      .eq("status", "running")
      .lt("started_at", stuckCutoff),
    countCapHits(sb, workspaceId, since7d),
    countGateFailures(sb, workspaceId, since7d),
    avgLatency(sb, workspaceId, since24h),
  ]);

  const dailyCap = dailyCapUsd();
  const stuck = (stuckJobs.data as Array<{ id: string; started_at: string | null }> | null) || [];

  // Latest completed job (for "last successful generation" timestamp).
  const { data: lastSuccess } = await sb
    .from("ai_generation_jobs")
    .select("completed_at, post_id, kind")
    .eq("workspace_id", workspaceId)
    .eq("status", "completed")
    .order("completed_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return okResponse({
    studio_enabled: studioEnabled(),
    workspace_id: workspaceId,
    daily_cap_usd: dailyCap,
    per_row_cap_usd: perRowCapUsd(),
    spend_today_usd: todays,
    spend_today_pct: Math.min(100, Math.round((todays / dailyCap) * 100)),
    spend_24h_usd: spend24h,
    jobs: {
      queued: queuedCount,
      running: runningCount,
      stuck: stuck.length,
      stuck_ids: stuck.slice(0, 5).map((j) => j.id),
      failed_24h: failed24h,
      completed_24h: completed24h,
    },
    quality: {
      cap_hits_7d: capHits7d,
      gate_failures_7d: gateFailures7d,
      avg_latency_ms_24h: avgLatency24h,
    },
    last_success: lastSuccess
      ? {
          at: (lastSuccess as { completed_at?: string | null }).completed_at || null,
          post_id: (lastSuccess as { post_id?: string | null }).post_id || null,
          kind: (lastSuccess as { kind?: string | null }).kind || null,
        }
      : null,
    timestamp: new Date().toISOString(),
  });
}

async function sumCost(sb: SupabaseClient, workspaceId: string, sinceIso: string): Promise<number> {
  const { data } = await sb
    .from("ai_generation_jobs")
    .select("cost_usd, status")
    .eq("workspace_id", workspaceId)
    .gte("created_at", sinceIso);
  const total = (data || []).reduce((acc, r) => {
    const row = r as { cost_usd?: number | null; status?: string };
    if (row.status === "cancelled") return acc;
    return acc + (Number(row.cost_usd) || 0);
  }, 0);
  return Math.round(total * 10000) / 10000;
}

async function countByStatus(sb: SupabaseClient, workspaceId: string, status: string): Promise<number> {
  const { count } = await sb
    .from("ai_generation_jobs")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .eq("status", status);
  return count || 0;
}

async function countWithStatusSince(sb: SupabaseClient, workspaceId: string, status: string, sinceIso: string): Promise<number> {
  const { count } = await sb
    .from("ai_generation_jobs")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .eq("status", status)
    .gte("created_at", sinceIso);
  return count || 0;
}

async function countCapHits(sb: SupabaseClient, workspaceId: string, sinceIso: string): Promise<number> {
  // The worker stamps cap_hit=true on the audit metadata for cap-related failures.
  const { data } = await sb
    .from("audit_log_v2")
    .select("metadata")
    .eq("workspace_id", workspaceId)
    .in("action", ["ai_post_generate_failed", "ai_post_revise_failed"])
    .gte("created_at", sinceIso);
  return ((data as Array<{ metadata?: { cap_hit?: boolean } | null }> | null) || [])
    .filter((r) => Boolean(r.metadata?.cap_hit)).length;
}

async function countGateFailures(sb: SupabaseClient, workspaceId: string, sinceIso: string): Promise<number> {
  const { data } = await sb
    .from("ai_generation_jobs")
    .select("error, status")
    .eq("workspace_id", workspaceId)
    .eq("status", "failed")
    .gte("created_at", sinceIso);
  return ((data as Array<{ error?: string | null }> | null) || [])
    .filter((r) => (r.error || "").includes("hallucination_gate_failed")).length;
}

async function avgLatency(sb: SupabaseClient, workspaceId: string, sinceIso: string): Promise<number> {
  const { data } = await sb
    .from("audit_log_v2")
    .select("metadata")
    .eq("workspace_id", workspaceId)
    .in("action", ["ai_post_generated", "ai_post_revised"])
    .gte("created_at", sinceIso);
  const latencies = ((data as Array<{ metadata?: { latency_ms?: number } | null }> | null) || [])
    .map((r) => Number(r.metadata?.latency_ms))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (latencies.length === 0) return 0;
  return Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length);
}
