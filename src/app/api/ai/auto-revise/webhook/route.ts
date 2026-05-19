// POST /api/ai/auto-revise/webhook
//
// Supabase Database Webhook target. Fires on every UPDATE to public.posts.
// We filter for the precise transition that means "human asked AI to fix":
//  - old.stage != 'revision_needed'
//  - new.stage == 'revision_needed'
//  - new.generated_by_model IS NOT NULL  (AI-originated post)
//  - new.notes has non-trivial reviewer text
//
// Anything else returns 204. The handler enqueues an ai_generation_jobs
// row with kind='revise' and returns within 50ms; the heavy lifting runs
// in the cron worker so we don't blow past the webhook's 10s timeout.
//
// Auth: shared secret in Authorization header (configured in the Supabase
// dashboard).

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { timingSafeEqual } from "node:crypto";
import { studioEnabled } from "@/lib/ai/feature-flag";

// SEC-007: Constant-time string compare for shared-secret auth. A raw `===`
// comparison leaks information about the secret one byte at a time via
// response timing. timingSafeEqual is the standard mitigation.
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

/**
 * Pull the latest reviewer kickback note from the accumulated posts.notes
 * field. The existing kickback flow appends entries like:
 *   "<author> (<timestamp>): Fix submitted — <note>"
 * separated by blank lines. We want the trailing block.
 */
function extractLatestReviewerNote(rawNotes: string): string {
  if (!rawNotes) return "";
  const blocks = rawNotes.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  if (blocks.length === 0) return "";
  const last = blocks[blocks.length - 1];
  // [\s\S]+ matches any char including newlines without needing the /s flag
  // (which requires ES2018+ — tsconfig targets ES2017 here).
  const fixMatch = last.match(/Fix submitted\s+—\s+([\s\S]+)$/);
  if (fixMatch && fixMatch[1]) return fixMatch[1].trim();
  // Legacy / direct-typed note: return the last block as-is.
  return last;
}

type PostsWebhookPayload = {
  type: "UPDATE" | "INSERT" | "DELETE";
  table: "posts";
  schema: "public";
  record?: Record<string, unknown> & {
    id?: string;
    stage?: string;
    workspace_id?: string;
    generated_by_model?: string | null;
    notes?: string | null;
  };
  old_record?: Record<string, unknown> & { stage?: string };
};

export async function POST(req: NextRequest) {
  const secret = process.env.SUPABASE_WEBHOOK_SECRET || "";
  const authHeader = req.headers.get("authorization") || req.headers.get("Authorization") || "";
  const provided = authHeader.replace(/^Bearer\s+/i, "");
  if (!secret || !safeEqual(provided, secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // Feature kill switch — silently drop webhooks when disabled so Supabase
  // doesn't enter a retry storm if we flip the flag mid-incident.
  if (!studioEnabled()) {
    return new NextResponse(null, { status: 204 });
  }

  let payload: PostsWebhookPayload;
  try {
    payload = (await req.json()) as PostsWebhookPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!payload || payload.type !== "UPDATE" || payload.table !== "posts") {
    return new NextResponse(null, { status: 204 });
  }
  const oldStage = payload.old_record?.stage;
  const newStage = payload.record?.stage;
  const generatedByModel = payload.record?.generated_by_model;
  const notes = (payload.record?.notes || "").toString();
  const workspaceId = payload.record?.workspace_id;
  const postId = payload.record?.id;

  if (!postId || !workspaceId) return new NextResponse(null, { status: 204 });
  if (oldStage === newStage || newStage !== "revision_needed") return new NextResponse(null, { status: 204 });
  if (!generatedByModel) return new NextResponse(null, { status: 204 });

  // posts.notes is an append-only comment thread (see pipeline-context.tsx
  // submitKickback). Extract just the most recent "Fix submitted —" entry
  // so the AI gets the reviewer's CURRENT note, not the full history.
  const recentNote = extractLatestReviewerNote(notes);
  if (recentNote.trim().length < 10) return new NextResponse(null, { status: 204 });

  const sb = adminClient();

  // Refuse to enqueue if a revise job is already in-flight for this post.
  const { data: inflight } = await sb
    .from("ai_generation_jobs")
    .select("id, status")
    .eq("post_id", postId)
    .eq("kind", "revise")
    .in("status", ["queued", "running"])
    .limit(1);
  if (inflight && inflight.length > 0) return new NextResponse(null, { status: 204 });

  await sb.from("ai_generation_jobs").insert({
    workspace_id: workspaceId,
    kind: "revise",
    status: "queued",
    post_id: postId,
    requested_by: "webhook:auto-revise",
    payload: { reviewer_notes: recentNote.slice(0, 4000) },
  });

  // Kick the worker so the user sees the revision within ~30s instead of waiting for cron.
  const triggerSecret = process.env.AI_WORKER_TRIGGER_SECRET || process.env.CRON_SECRET;
  if (triggerSecret) {
    void fetch(`${req.nextUrl.origin}/api/ai/auto-revise/process`, {
      method: "POST",
      headers: { "x-trigger-secret": triggerSecret },
    }).catch(() => {});
  }

  return NextResponse.json({ accepted: true }, { status: 202 });
}
