// POST /api/ai/auto-revise/process
//
// Worker route invoked by:
//  1. Vercel cron — Vercel sends `Authorization: Bearer <CRON_SECRET>`.
//  2. Internal AI queue triggers — header x-trigger-secret.
//
// Both paths are verified by shared secret. Pulls up to 3 queued jobs,
// runs them serially (one OpenAI image call at a time keeps us under rate
// limits and lets each take its full time without timing out neighbours).

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { timingSafeEqual } from "node:crypto";
import { runGenerateJob, runReviseJob } from "@/lib/ai/worker";
import { studioEnabled } from "@/lib/ai/feature-flag";

// SEC-008: Constant-time string compare. Prevents leaking secret length and
// bytes through response-time side channels on each authentication path.
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
}

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function isAuthorized(req: NextRequest): boolean {
  const auth = (req.headers.get("authorization") || req.headers.get("Authorization") || "").trim();
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  const trigger = (req.headers.get("x-trigger-secret") || "").trim();
  const cronSecret = (process.env.CRON_SECRET || "").trim();
  const triggerSecret = (process.env.AI_WORKER_TRIGGER_SECRET || cronSecret).trim();
  // Vercel cron sends Authorization: Bearer <CRON_SECRET>.
  if (bearer && cronSecret && safeEqual(bearer, cronSecret)) return true;
  // Internal trigger from generate-row / webhook routes.
  if (trigger && triggerSecret && safeEqual(trigger, triggerSecret)) return true;
  return false;
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // Feature kill switch — when off, the worker drains nothing. Queued
  // jobs stay queued so a flip back to enabled doesn't lose work.
  if (!studioEnabled()) {
    return NextResponse.json({ ok: true, processed: 0, reason: "feature_disabled" });
  }

  const sb = adminClient();
  // Reclaim jobs that have been "running" too long (worker crashed mid-flight).
  const reclaimCutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  await sb
    .from("ai_generation_jobs")
    .update({ status: "queued", claim_token: null, claimed_at: null, started_at: null })
    .eq("status", "running")
    .lt("started_at", reclaimCutoff);

  const { data: queued } = await sb
    .from("ai_generation_jobs")
    .select("id, kind")
    .eq("status", "queued")
    .order("created_at", { ascending: true })
    .limit(3);

  if (!queued || queued.length === 0) {
    return NextResponse.json({ ok: true, processed: 0 });
  }

  let processed = 0;
  for (const job of queued) {
    try {
      if (job.kind === "generate") await runGenerateJob(job.id);
      else if (job.kind === "revise") await runReviseJob(job.id);
      processed++;
    } catch (err) {
      console.error("[ai-process] job error", job.id, err);
    }
  }
  return NextResponse.json({ ok: true, processed });
}

// SEC-021: Drop the GET alias. The Vercel cron pinger uses POST with the
// CRON_SECRET bearer; the unconditional GET delegate previously let cached
// CDNs / link-preview crawlers replay the worker by following any leaked URL.
export async function GET() {
  return NextResponse.json({ error: "Use POST" }, { status: 405 });
}
