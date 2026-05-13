// Per-call cost tally + daily workspace cap + per-row hard ceiling.
//
// Defence-in-depth: three layers of spend protection so a single runaway
// job, a tampered client, or a misconfigured price can't blow past the cap.
//
//   1. Pre-flight: enforceDailyCap() at API entry — checks committed spend.
//   2. Pre-charge: writeJobPrecharge() reserves the estimated cost on the
//      job row at claim time, so concurrent batches see committed spend.
//   3. Mid-flight: enforceMidFlightCap() between text + each image call —
//      stops a bad job that started under-budget but ran over.
//   4. Per-row ceiling: enforcePerRowCap() refuses any single job whose
//      tally crosses PER_ROW_HARD_CAP_USD (default $3). Saves you from
//      one row eating the whole daily allowance.
//
// Prices below are conservative defaults — the OpenAI invoice is the only
// real source of truth. Bias the defaults high so the cap fires BEFORE the
// invoice does. Override per env var.

import { createClient, SupabaseClient } from "@supabase/supabase-js";

const DEFAULT_DAILY_CAP_USD = 10;
const DEFAULT_PER_ROW_CAP_USD = 3;

// Per-1k-token costs in USD. Bias high so the cap fires before the bill does.
const TEXT_INPUT_PER_1K = Number(process.env.OPENAI_PRICE_TEXT_IN) || 0.0025;
const TEXT_OUTPUT_PER_1K = Number(process.env.OPENAI_PRICE_TEXT_OUT) || 0.01;
// gpt-image-2 at $30/M output tokens, typical 1024×1536 image ~15-30k tokens.
// Conservative estimate of $0.50 per image so the cap fires before the bill does.
const IMAGE_PER_GENERATION = Number(process.env.OPENAI_PRICE_IMAGE) || 0.50;
// Verifier (gpt-4o-mini) — cheaper than the main text model
const VERIFIER_INPUT_PER_1K = Number(process.env.OPENAI_PRICE_VERIFIER_IN) || 0.00015;
const VERIFIER_OUTPUT_PER_1K = Number(process.env.OPENAI_PRICE_VERIFIER_OUT) || 0.0006;

export interface UsageTally {
  textIn: number;
  textOut: number;
  verifierIn: number;
  verifierOut: number;
  images: number;
}

export function computeCostUsd(u: UsageTally): number {
  const text = (u.textIn / 1000) * TEXT_INPUT_PER_1K + (u.textOut / 1000) * TEXT_OUTPUT_PER_1K;
  const verifier =
    (u.verifierIn / 1000) * VERIFIER_INPUT_PER_1K + (u.verifierOut / 1000) * VERIFIER_OUTPUT_PER_1K;
  const image = u.images * IMAGE_PER_GENERATION;
  // Round to 4 decimal places to match the cost_usd column precision.
  return Math.round((text + verifier + image) * 10000) / 10000;
}

export class DailyCapExceeded extends Error {
  constructor(public spentToday: number, public capUsd: number) {
    super(`Daily AI spend cap reached: $${spentToday.toFixed(2)} / $${capUsd.toFixed(2)}`);
    this.name = "DailyCapExceeded";
  }
}

function adminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase admin not configured");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export function dailyCapUsd(): number {
  const v = Number(process.env.OPENAI_DAILY_CAP_USD);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_DAILY_CAP_USD;
}

export function perRowCapUsd(): number {
  const v = Number(process.env.OPENAI_PER_ROW_CAP_USD);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_PER_ROW_CAP_USD;
}

/**
 * Sum today's AI cost for a workspace from ai_generation_jobs. Includes
 * completed jobs (real cost), running jobs (pre-charge estimate), and
 * failed jobs (we paid for the attempt — leave it counted). Cancelled
 * jobs are NOT counted because nothing was actually called.
 */
export async function todaysSpend(workspaceId: string): Promise<number> {
  const sb = adminClient();
  const sinceIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await sb
    .from("ai_generation_jobs")
    .select("cost_usd, status")
    .eq("workspace_id", workspaceId)
    .gte("created_at", sinceIso);
  if (error) {
    // Fail open — we'd rather over-spend by one job than block the whole feature.
    console.error("[cost] todaysSpend error", error.message);
    return 0;
  }
  const total = (data || []).reduce((acc, r) => {
    if (r.status === "cancelled") return acc;
    return acc + (Number(r.cost_usd) || 0);
  }, 0);
  return Math.round(total * 10000) / 10000;
}

/** Throw DailyCapExceeded if today's spend is at or above the cap. */
export async function enforceDailyCap(workspaceId: string): Promise<void> {
  const cap = dailyCapUsd();
  const spent = await todaysSpend(workspaceId);
  if (spent >= cap) throw new DailyCapExceeded(spent, cap);
}

export class PerRowCapExceeded extends Error {
  constructor(public spentOnRow: number, public capUsd: number) {
    super(`Per-row AI cost cap reached: $${spentOnRow.toFixed(2)} / $${capUsd.toFixed(2)} on a single job`);
    this.name = "PerRowCapExceeded";
  }
}

/**
 * Pre-flight cost estimate for a single job. Used to:
 *   (a) Refuse jobs whose worst-case cost would exceed the per-row cap.
 *   (b) Write a pre-charge to the job row at claim time so concurrent
 *       batches see the committed spend, not just completed spend.
 */
export function estimateJobCostUsd(args: { imageCount: number; isVerifierExpected?: boolean }): number {
  // Text: assume ~2000 input tokens + ~1500 output tokens (carousel JSON).
  const textCost = (2000 / 1000) * TEXT_INPUT_PER_1K + (1500 / 1000) * TEXT_OUTPUT_PER_1K;
  // Verifier: ~6000 input + ~50 output (when corpus is tight).
  const verifierCost = args.isVerifierExpected !== false
    ? (6000 / 1000) * VERIFIER_INPUT_PER_1K + (50 / 1000) * VERIFIER_OUTPUT_PER_1K
    : 0;
  // Images at high quality dominate cost.
  const imageCost = args.imageCount * IMAGE_PER_GENERATION;
  return Math.round((textCost + verifierCost + imageCost) * 10000) / 10000;
}

/** Throw PerRowCapExceeded if a single job's running tally crosses the per-row cap. */
export function enforcePerRowCap(spentOnRow: number): void {
  const cap = perRowCapUsd();
  if (spentOnRow >= cap) throw new PerRowCapExceeded(spentOnRow, cap);
}

/**
 * Write an estimated cost to the job row so the daily-cap aggregator sees
 * this job's committed spend immediately (instead of only after the job
 * completes). Without this, 5 concurrent batch generates could all pass
 * the pre-flight cap check before any has actually spent.
 */
export async function writeJobPrecharge(jobId: string, estimatedUsd: number): Promise<void> {
  const sb = adminClient();
  const { error } = await sb
    .from("ai_generation_jobs")
    .update({ cost_usd: estimatedUsd })
    .eq("id", jobId);
  if (error) console.error("[cost] writeJobPrecharge error", error.message);
}

/**
 * Mid-flight cap check that combines today's committed spend with the
 * current job's running tally. Call this after the text generation and
 * after every image, BEFORE the next expensive call. Throws either
 * DailyCapExceeded or PerRowCapExceeded — the worker catches both and
 * fails the job cleanly.
 */
export async function enforceMidFlightCap(args: {
  workspaceId: string;
  jobId: string;
  spentOnThisJob: number;
}): Promise<void> {
  enforcePerRowCap(args.spentOnThisJob);
  const cap = dailyCapUsd();
  // todaysSpend already includes this job's pre-charge (we wrote it at
  // claim time). To avoid double-counting the running total, we subtract
  // the pre-charge from spent and add the real running tally.
  const spent = await todaysSpend(args.workspaceId);
  const sb = adminClient();
  const { data } = await sb
    .from("ai_generation_jobs")
    .select("cost_usd")
    .eq("id", args.jobId)
    .maybeSingle();
  const previouslyRecorded = Number((data as { cost_usd?: number } | null)?.cost_usd) || 0;
  const trueSpent = spent - previouslyRecorded + args.spentOnThisJob;
  if (trueSpent >= cap) throw new DailyCapExceeded(trueSpent, cap);
}
