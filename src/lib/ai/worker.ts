// Orchestration glue for AI generation + revision jobs. Owns the full
// pipeline: load context → call OpenAI text + image → run gate → upload →
// persist → record audit → mark job complete. All transitions are wrapped
// in try/catch so a failure anywhere lands as a clean `failed` job with
// `last_error` populated rather than half-baked state.

import { createClient, SupabaseClient } from "@supabase/supabase-js";
import {
  AiJobRow,
  BrandPlaybookRow,
  BuildPromptContext,
  GeneratedCaption,
  PlanRow,
  ResolvedAspect,
} from "./types";
import { resolveAspect, imageCountForPlan } from "./aspect-resolver";
import { callTextJson } from "./openai-text";
import { callImage } from "./openai-image";
import { processImage } from "./image-postprocess";
import { uploadAssets, rekeyAndResignAssets } from "./upload";
import {
  buildTextSystem,
  buildTextUser,
  buildImagePrompts,
  generatedCaptionSchema,
  normalizeGeneration,
  PROMPT_VERSION,
} from "./prompt-builder";
import { runHallucinationGate } from "./hallucination-gate";
import {
  buildPostInsertRow,
  insertGeneratedPost,
  updateRevisedPost,
} from "./persist";
import {
  computeCostUsd,
  enforceDailyCap,
  enforceMidFlightCap,
  estimateJobCostUsd,
  writeJobPrecharge,
  DailyCapExceeded,
  PerRowCapExceeded,
} from "./cost";
import { aiAssetProxyUrl } from "./asset-url";
import { aiAssetPublishUrl } from "./asset-publish-url";

function adminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase admin not configured");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

const TEXT_MODEL_DEFAULT = "gpt-4o-mini";
const IMAGE_MODEL_DEFAULT = "gpt-image-2";

function textModel() {
  return process.env.OPENAI_TEXT_MODEL || TEXT_MODEL_DEFAULT;
}
function imageModel() {
  return process.env.OPENAI_IMAGE_MODEL || IMAGE_MODEL_DEFAULT;
}

interface LoadCtxResult {
  plan: PlanRow;
  brand: BrandPlaybookRow | null;
  recent: Array<{ hook: string | null; caption: string | null; title: string | null }>;
}

async function loadGenerateContext(sb: SupabaseClient, planRowId: string): Promise<LoadCtxResult> {
  const { data: plan, error: planErr } = await sb
    .from("content_plan_rows")
    .select("*")
    .eq("id", planRowId)
    .single();
  if (planErr || !plan) throw new Error(`Plan row not found: ${planErr?.message || "missing"}`);

  const { data: brand } = await sb
    .from("brand_playbook")
    .select("id, workspace_id, data")
    .eq("workspace_id", plan.workspace_id)
    .maybeSingle();

  const { data: recent } = await sb
    .from("posts")
    .select("title, hook, caption")
    .eq("workspace_id", plan.workspace_id)
    .order("created_at", { ascending: false })
    .limit(10);

  return {
    plan: plan as PlanRow,
    brand: (brand as BrandPlaybookRow) || null,
    recent: (recent as Array<{ title: string | null; hook: string | null; caption: string | null }> | null) || [],
  };
}

async function loadReviseContext(sb: SupabaseClient, postId: string, workspaceId: string, reviewerNotes: string) {
  const { data: post, error } = await sb
    .from("posts")
    .select("*")
    .eq("id", postId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error || !post) throw new Error(`Post not found for revise: ${error?.message || "missing"}`);

  // Preserve the *original* operator intent by looking up the source plan row.
  // Without this the revise pipeline used post.title (a short internal name)
  // as the topic, which drifted away from the operator's original instructions.
  let originalTopic: string | null = null;
  let originalNotes: string | null = null;
  if (post.plan_row_id) {
    const { data: planRow } = await sb
      .from("content_plan_rows")
      .select("topic, notes")
      .eq("id", post.plan_row_id)
      .maybeSingle();
    if (planRow) {
      originalTopic = (planRow.topic as string | null) ?? null;
      originalNotes = (planRow.notes as string | null) ?? null;
    }
  }

  // Build a synthetic PlanRow from the post so the rest of the pipeline is symmetrical.
  const plan: PlanRow = {
    id: post.plan_row_id || post.id,
    workspace_id: post.workspace_id,
    created_by: post.created_by || "ai:revise",
    row_index: 0,
    scheduled_date: post.scheduled_date || null,
    scheduled_time: post.scheduled_time || null,
    platforms: post.platforms || null,
    media_type: post.media_type || "image",
    format: (post.content_type === "carousel" ? "carousel" : post.content_type === "story" ? "story" : post.media_type === "video" ? "reel" : "single") as PlanRow["format"],
    slides_count: post.slides_count || (Array.isArray(post.asset_urls) ? post.asset_urls.length : 1),
    resolved_aspect: post.aspect_ratio || "4:5",
    feel: post.feel || null,
    visual_style: post.visual_style || null,
    style_prompt: post.style_prompt || null,
    // Prefer the operator's original topic, fall back to the AI-generated title.
    topic: originalTopic || post.title || null,
    notes: [originalNotes, reviewerNotes].filter(Boolean).join("\n\n"),
    status: "revising",
    generated_post_id: post.id,
    last_error: null,
    cost_usd: null,
    created_at: post.created_at || new Date().toISOString(),
    updated_at: post.updated_at || new Date().toISOString(),
  };

  const { data: brand } = await sb
    .from("brand_playbook")
    .select("id, workspace_id, data")
    .eq("workspace_id", post.workspace_id)
    .maybeSingle();

  const { data: recent } = await sb
    .from("posts")
    .select("title, hook, caption")
    .eq("workspace_id", post.workspace_id)
    .neq("id", post.id)
    .order("created_at", { ascending: false })
    .limit(10);

  return {
    plan,
    brand: (brand as BrandPlaybookRow) || null,
    recent: (recent as Array<{ title: string | null; hook: string | null; caption: string | null }> | null) || [],
    sourcePost: post,
  };
}

async function runTextGeneration(
  ctx: BuildPromptContext,
  retryReason: string | null,
): Promise<{ caption: GeneratedCaption; tokensIn: number; tokensOut: number; model: string }> {
  const imageCount = imageCountForPlan(
    (ctx.plan.format || "single") as never,
    (ctx.plan.media_type || "image") as never,
    ctx.plan.slides_count ?? null,
  );
  const system = buildTextSystem(ctx) +
    (retryReason ? `\n\nPRIOR ATTEMPT FAILED VALIDATION. Do not include any of: ${retryReason}` : "");
  const user = buildTextUser(ctx);
  const result = await callTextJson<GeneratedCaption>({
    model: textModel(),
    system,
    user,
    schema: generatedCaptionSchema(imageCount),
    schemaName: "generated_caption",
    maxTokens: 3000,
    temperature: 0.7,
  });
  return {
    caption: normalizeGeneration(result.parsed),
    tokensIn: result.tokensIn,
    tokensOut: result.tokensOut,
    model: result.model,
  };
}

async function generateImagesForCaption(
  ctx: BuildPromptContext,
  caption: GeneratedCaption,
  resolved: ResolvedAspect,
) {
  const prompts = buildImagePrompts(ctx, caption.scene_outline);
  const out: Array<{ bytes: Buffer; mime: "image/png" }> = [];
  for (const prompt of prompts) {
    const img = await callImage({ model: imageModel(), prompt, size: resolved.openaiSize, quality: "high" });
    const processed = await processImage(img.base64, resolved);
    out.push({ bytes: processed.bytes, mime: "image/png" });
  }
  return out;
}

/**
 * Same as generateImagesForCaption but with cap enforcement between each
 * image. If a mid-job cap is hit, throws immediately so the worker fails
 * the job cleanly rather than continuing to spend.
 */
async function generateImagesForCaptionWithCapChecks(args: {
  ctx: BuildPromptContext;
  caption: GeneratedCaption;
  resolved: ResolvedAspect;
  jobId: string;
  workspaceId: string;
  tally: { textIn: number; textOut: number; verifierIn: number; verifierOut: number; images: number };
}): Promise<Array<{ bytes: Buffer; mime: "image/png" }>> {
  const prompts = buildImagePrompts(args.ctx, args.caption.scene_outline);
  const out: Array<{ bytes: Buffer; mime: "image/png" }> = [];
  for (const prompt of prompts) {
    // Cap check BEFORE the call — once we've authorized a $0.50 image we
    // commit to paying for it.
    await enforceMidFlightCap({
      workspaceId: args.workspaceId,
      jobId: args.jobId,
      spentOnThisJob: computeCostUsd(args.tally),
    });
    const img = await callImage({ model: imageModel(), prompt, size: args.resolved.openaiSize, quality: "high" });
    const processed = await processImage(img.base64, args.resolved);
    out.push({ bytes: processed.bytes, mime: "image/png" });
    args.tally.images += 1;
  }
  return out;
}

async function claimJob(sb: SupabaseClient, jobId: string): Promise<AiJobRow | null> {
  const { data, error } = await sb
    .from("ai_generation_jobs")
    .update({ status: "running", started_at: new Date().toISOString(), claim_token: crypto.randomUUID(), claimed_at: new Date().toISOString() })
    .eq("id", jobId)
    .eq("status", "queued")
    .select("*")
    .single();
  if (error || !data) return null;
  return data as AiJobRow;
}

async function failJob(sb: SupabaseClient, jobId: string, errMessage: string) {
  await sb.from("ai_generation_jobs").update({ status: "failed", error: errMessage.slice(0, 2000), completed_at: new Date().toISOString() }).eq("id", jobId);
  // Find the plan row attached so we can mark it failed too.
  const { data } = await sb.from("ai_generation_jobs").select("plan_row_id").eq("id", jobId).single();
  if (data?.plan_row_id) {
    await sb.from("content_plan_rows").update({ status: "failed", last_error: errMessage.slice(0, 2000) }).eq("id", data.plan_row_id);
  }
}

async function recordAudit(
  sb: SupabaseClient,
  workspaceId: string,
  action: string,
  postId: string | null,
  meta: Record<string, unknown>,
) {
  try {
    await sb.rpc("record_audit_event", {
      p_entity_type: "post",
      p_action: action,
      p_entity_id: postId,
      p_workspace_id: workspaceId,
      p_metadata: meta,
    });
  } catch (err) {
    console.error("[ai-worker] audit failed", action, err);
  }
}

/** Execute a generate job from end to end. Marks the job + plan row complete/failed. */
export async function runGenerateJob(jobId: string): Promise<void> {
  const sb = adminClient();
  const job = await claimJob(sb, jobId);
  if (!job) return; // someone else claimed it (or it isn't queued)
  const t0 = Date.now();
  try {
    if (!job.plan_row_id) throw new Error("generate job missing plan_row_id");
    await enforceDailyCap(job.workspace_id);

    // Idempotency guard — if a concurrent job already produced a post for
    // this plan row, abort cleanly. Belt-and-suspenders for the API-side
    // "no in-flight" check, which has a race window of a few ms between
    // the SELECT and the INSERT of the duplicate job.
    const { data: planCheck } = await sb
      .from("content_plan_rows")
      .select("generated_post_id, status")
      .eq("id", job.plan_row_id)
      .maybeSingle();
    if (planCheck?.generated_post_id) {
      await sb.from("ai_generation_jobs")
        .update({
          status: "cancelled",
          completed_at: new Date().toISOString(),
          error: "duplicate_job: plan row already has a generated post",
          result: { duplicate_of: planCheck.generated_post_id },
        })
        .eq("id", jobId);
      return;
    }

    const { plan, brand, recent } = await loadGenerateContext(sb, job.plan_row_id);
    const resolved = resolveAspect({
      mediaType: (plan.media_type || "image") as never,
      format: (plan.format || "single") as never,
      platforms: plan.platforms || [],
    });

    // Pre-charge: write the estimated cost to the job row NOW so concurrent
    // batches see this job's committed spend in the daily-cap aggregator.
    // Will be replaced with the actual cost on completion.
    const expectedImages = imageCountForPlan(
      (plan.format || "single") as never,
      (plan.media_type || "image") as never,
      plan.slides_count ?? null,
    );
    const estimate = estimateJobCostUsd({ imageCount: expectedImages });
    await writeJobPrecharge(jobId, estimate);

    const promptCtx: BuildPromptContext = { brand, recentPosts: recent, plan, resolved };

    // Tally accumulates across the job. Used for mid-flight cap checks and
    // for the per-row hard ceiling. Updated after each expensive call.
    const tally = { textIn: 0, textOut: 0, verifierIn: 0, verifierOut: 0, images: 0 };

    // First text attempt.
    let textResult = await runTextGeneration(promptCtx, null);
    tally.textIn += textResult.tokensIn; tally.textOut += textResult.tokensOut;

    // Hallucination gate (first pass).
    let gate = await runHallucinationGate({ caption: textResult.caption, plan, brand: brand?.data || null });
    tally.verifierIn += gate.verifierTokensIn; tally.verifierOut += gate.verifierTokensOut;
    if (!gate.ok) {
      const retry = gate.violations.join("; ");
      textResult = await runTextGeneration(promptCtx, retry);
      tally.textIn += textResult.tokensIn; tally.textOut += textResult.tokensOut;
      gate = await runHallucinationGate({ caption: textResult.caption, plan, brand: brand?.data || null });
      tally.verifierIn += gate.verifierTokensIn; tally.verifierOut += gate.verifierTokensOut;
      if (!gate.ok) {
        throw new Error(`hallucination_gate_failed: ${gate.violations.slice(0, 3).join("; ")}`);
      }
    }

    // Mid-flight cap check before the (expensive) image phase. Catches the
    // case where the text + verifier alone already pushed us over.
    await enforceMidFlightCap({
      workspaceId: job.workspace_id,
      jobId,
      spentOnThisJob: computeCostUsd(tally),
    });

    // Images, with cap check between each generation. If a 5-slide carousel
    // would push us over, we stop after the slides we've already paid for.
    const processed = await generateImagesForCaptionWithCapChecks({
      ctx: promptCtx,
      caption: textResult.caption,
      resolved,
      jobId,
      workspaceId: job.workspace_id,
      tally,
    });

    // Build placeholder post id so storage path is stable BEFORE insert.
    const provisionalId = crypto.randomUUID();
    const assets = await uploadAssets({
      workspaceId: plan.workspace_id,
      postId: provisionalId,
      images: processed,
    });

    // Insert the post, then patch its id to provisionalId? Cleaner: insert with the assets we already have.
    const inserted = await insertGeneratedPost({
      workspaceId: plan.workspace_id,
      actorEmail: job.requested_by || "ai:system",
      plan,
      caption: textResult.caption,
      resolved,
      assets,
      textModel: textModel(),
      imageModel: imageModel(),
      promptVersion: PROMPT_VERSION,
    });

    // Re-key the assets to the real post id so the bucket layout is
    // canonical, AND re-sign URLs because Supabase signed URLs are bound
    // to the original storage path — moving an object invalidates the URL.
    // Failure here is non-fatal (the post will keep working with the
    // provisional path), but logged.
    try {
      const reSigned = await rekeyAndResignAssets({
        oldPrefix: `${plan.workspace_id}/${provisionalId}/`,
        newPrefix: `${plan.workspace_id}/${inserted.id}/`,
        assets,
      });
      await sb
        .from("posts")
        .update({
          asset_storage_keys: reSigned.map((a) => a.storageKey),
          asset_urls: reSigned.map((a) => aiAssetPublishUrl(a.storageKey)),
          thumbnail_url: reSigned[0] ? aiAssetProxyUrl(reSigned[0].storageKey) : null,
        })
        .eq("id", inserted.id);
    } catch (err) {
      console.error("[ai-worker] asset rename failed (non-fatal)", err);
    }

    // Reconcile pre-charge with actual cost. tally was kept up to date
    // through the run; this is the canonical end-of-job number.
    const usage = { ...tally };
    const costUsd = computeCostUsd(usage);
    const latencyMs = Date.now() - t0;

    // Update plan row + job + audit
    await sb.from("content_plan_rows").update({
      status: "generated",
      generated_post_id: inserted.id,
      last_error: null,
      cost_usd: costUsd,
    }).eq("id", plan.id);

    await sb.from("ai_generation_jobs").update({
      status: "completed",
      completed_at: new Date().toISOString(),
      post_id: inserted.id,
      tokens_in: usage.textIn + usage.verifierIn,
      tokens_out: usage.textOut + usage.verifierOut,
      images_generated: usage.images,
      cost_usd: costUsd,
      result: {
        caption_summary: textResult.caption.title,
        quality_score: textResult.caption.quality_score,
        precharge_estimate: estimate,
      },
    }).eq("id", jobId);

    await recordAudit(sb, job.workspace_id, "ai_post_generated", inserted.id, {
      job_id: jobId,
      plan_row_id: plan.id,
      model: textModel(),
      image_model: imageModel(),
      prompt_version: PROMPT_VERSION,
      tokens_in: usage.textIn + usage.verifierIn,
      tokens_out: usage.textOut + usage.verifierOut,
      images_generated: usage.images,
      cost_usd: costUsd,
      precharge_estimate: estimate,
      latency_ms: latencyMs,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const capHit = err instanceof DailyCapExceeded || err instanceof PerRowCapExceeded;
    const detailed = capHit ? msg : msg;
    await failJob(sb, jobId, detailed);
    await recordAudit(sb, job.workspace_id, "ai_post_generate_failed", null, { job_id: jobId, error: detailed, cap_hit: capHit });
  }
}

/** Execute a revise job. */
export async function runReviseJob(jobId: string): Promise<void> {
  const sb = adminClient();
  const job = await claimJob(sb, jobId);
  if (!job) return;
  const t0 = Date.now();
  try {
    const reviewerNotes = ((job.payload as Record<string, unknown>)?.reviewer_notes as string) || "";
    if (!job.post_id) throw new Error("revise job missing post_id");
    await enforceDailyCap(job.workspace_id);

    const { plan, brand, recent, sourcePost } = await loadReviseContext(sb, job.post_id, job.workspace_id, reviewerNotes);
    const resolved = resolveAspect({
      mediaType: (plan.media_type || "image") as never,
      format: (plan.format || "single") as never,
      platforms: plan.platforms || [],
    });

    // Pre-charge for the revise job (same logic as generate).
    const expectedImages = imageCountForPlan(
      (plan.format || "single") as never,
      (plan.media_type || "image") as never,
      plan.slides_count ?? null,
    );
    const estimate = estimateJobCostUsd({ imageCount: expectedImages });
    await writeJobPrecharge(jobId, estimate);

    const promptCtx: BuildPromptContext = {
      brand,
      recentPosts: recent,
      plan,
      resolved,
      reviseFromPost: {
        title: sourcePost.title || "",
        hook: sourcePost.hook || null,
        caption: sourcePost.caption || null,
        cta: sourcePost.cta || null,
        hashtags: sourcePost.hashtags || null,
        visual_brief: sourcePost.visual_brief || null,
        carousel_outline: sourcePost.carousel_outline || null,
      },
      reviewerNotes,
    };

    const tally = { textIn: 0, textOut: 0, verifierIn: 0, verifierOut: 0, images: 0 };

    let textResult = await runTextGeneration(promptCtx, null);
    tally.textIn += textResult.tokensIn; tally.textOut += textResult.tokensOut;
    let gate = await runHallucinationGate({ caption: textResult.caption, plan, brand: brand?.data || null, reviewerNotes });
    tally.verifierIn += gate.verifierTokensIn; tally.verifierOut += gate.verifierTokensOut;
    if (!gate.ok) {
      const retry = gate.violations.join("; ");
      textResult = await runTextGeneration(promptCtx, retry);
      tally.textIn += textResult.tokensIn; tally.textOut += textResult.tokensOut;
      gate = await runHallucinationGate({ caption: textResult.caption, plan, brand: brand?.data || null, reviewerNotes });
      tally.verifierIn += gate.verifierTokensIn; tally.verifierOut += gate.verifierTokensOut;
      if (!gate.ok) {
        throw new Error(`hallucination_gate_failed: ${gate.violations.slice(0, 3).join("; ")}`);
      }
    }

    await enforceMidFlightCap({
      workspaceId: job.workspace_id,
      jobId,
      spentOnThisJob: computeCostUsd(tally),
    });

    const processed = await generateImagesForCaptionWithCapChecks({
      ctx: promptCtx,
      caption: textResult.caption,
      resolved,
      jobId,
      workspaceId: job.workspace_id,
      tally,
    });

    // Operator-moved-the-card guard. If the post is no longer in
    // revision_needed (operator dragged it back to Ideas / approved it
    // manually / etc.) we MUST NOT write back — that would silently
    // override their decision. Abort and log.
    const { data: latest } = await sb
      .from("posts")
      .select("stage")
      .eq("id", sourcePost.id)
      .maybeSingle();
    if (latest?.stage && latest.stage !== "revision_needed") {
      await sb.from("ai_generation_jobs")
        .update({
          status: "cancelled",
          completed_at: new Date().toISOString(),
          error: `aborted: post left revision_needed (now ${latest.stage}) before revise completed`,
        })
        .eq("id", jobId);
      return;
    }

    const assets = await uploadAssets({
      workspaceId: plan.workspace_id,
      postId: sourcePost.id,
      images: processed,
    });

    await updateRevisedPost({
      postId: sourcePost.id,
      workspaceId: plan.workspace_id,
      caption: textResult.caption,
      resolved,
      assets,
      textModel: textModel(),
      imageModel: imageModel(),
      promptVersion: PROMPT_VERSION,
    });

    const usage = { ...tally };
    const costUsd = computeCostUsd(usage);
    const latencyMs = Date.now() - t0;

    if (sourcePost.plan_row_id) {
      await sb
        .from("content_plan_rows")
        .update({ status: "generated", last_error: null })
        .eq("id", sourcePost.plan_row_id);
    }
    await sb.from("ai_generation_jobs").update({
      status: "completed",
      completed_at: new Date().toISOString(),
      post_id: sourcePost.id,
      tokens_in: usage.textIn + usage.verifierIn,
      tokens_out: usage.textOut + usage.verifierOut,
      images_generated: usage.images,
      cost_usd: costUsd,
      result: { revision_of: sourcePost.id, quality_score: textResult.caption.quality_score },
    }).eq("id", jobId);

    await recordAudit(sb, job.workspace_id, "ai_post_revised", sourcePost.id, {
      job_id: jobId,
      model: textModel(),
      image_model: imageModel(),
      prompt_version: PROMPT_VERSION,
      tokens_in: usage.textIn + usage.verifierIn,
      tokens_out: usage.textOut + usage.verifierOut,
      images_generated: usage.images,
      cost_usd: costUsd,
      latency_ms: latencyMs,
      precharge_estimate: estimate,
      reviewer_notes_excerpt: reviewerNotes.slice(0, 200),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const capHit = err instanceof DailyCapExceeded || err instanceof PerRowCapExceeded;
    await failJob(sb, jobId, msg);
    await recordAudit(sb, job.workspace_id, "ai_post_revise_failed", job.post_id || null, { job_id: jobId, error: msg, cap_hit: capHit });
  }
}

// Re-export so callers don't reach into the namespace.
export { buildPostInsertRow };
