// POST /api/ai/auto-revise/process
//
// Worker route invoked by:
//  1. Vercel cron (every 1 min) — header x-vercel-cron-signature
//  2. The /api/ai/studio/generate-row endpoint — header x-trigger-secret
//
// Both paths are verified by shared secret. Pulls up to 3 queued jobs,
// runs them serially (one OpenAI image call at a time keeps us under rate
// limits and lets each take its full time without timing out neighbours).

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { runGenerateJob, runReviseJob } from "@/lib/ai/worker";

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function isAuthorized(req: NextRequest): boolean {
  const cronSig = req.headers.get("x-vercel-cron-signature") || "";
  const trigger = req.headers.get("x-trigger-secret") || "";
  const cronSecret = process.env.CRON_SECRET || "";
  const triggerSecret = process.env.AI_WORKER_TRIGGER_SECRET || cronSecret;
  if (cronSig && cronSecret && cronSig === cronSecret) return true;
  if (trigger && triggerSecret && trigger === triggerSecret) return true;
  return false;
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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

// Allow GET for the Vercel cron pinger which historically uses GET.
export async function GET(req: NextRequest) {
  return POST(req);
}
