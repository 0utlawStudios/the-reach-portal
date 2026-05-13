// Per-call cost tally + daily workspace cap enforcement.
//
// Token prices are conservative defaults — the actual OpenAI invoice is
// the source of truth, but for spend-gate purposes we want to slightly
// over-estimate rather than under-count and blow the cap. Bump these via
// the OPENAI_PRICE_* env vars if the OpenAI catalog moves under us.

import { createClient, SupabaseClient } from "@supabase/supabase-js";

const DEFAULT_DAILY_CAP_USD = 25;

// Per-1k-token costs in USD. Bias high so the cap fires before the bill does.
const TEXT_INPUT_PER_1K = Number(process.env.OPENAI_PRICE_TEXT_IN) || 0.0025;
const TEXT_OUTPUT_PER_1K = Number(process.env.OPENAI_PRICE_TEXT_OUT) || 0.01;
// gpt-image-1 high quality 1024x1536 image cost
const IMAGE_PER_GENERATION = Number(process.env.OPENAI_PRICE_IMAGE) || 0.19;
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

/** Sum today's AI cost for a workspace from ai_generation_jobs. */
export async function todaysSpend(workspaceId: string): Promise<number> {
  const sb = adminClient();
  const sinceIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await sb
    .from("ai_generation_jobs")
    .select("cost_usd")
    .eq("workspace_id", workspaceId)
    .gte("created_at", sinceIso);
  if (error) {
    // Fail open — we'd rather over-spend by one job than block the whole feature.
    console.error("[cost] todaysSpend error", error.message);
    return 0;
  }
  const total = (data || []).reduce((acc, r) => acc + (Number(r.cost_usd) || 0), 0);
  return Math.round(total * 10000) / 10000;
}

/** Throw DailyCapExceeded if today's spend is at or above the cap. */
export async function enforceDailyCap(workspaceId: string): Promise<void> {
  const cap = dailyCapUsd();
  const spent = await todaysSpend(workspaceId);
  if (spent >= cap) throw new DailyCapExceeded(spent, cap);
}
