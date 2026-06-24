// Translate a fully-validated generation result into a posts row. Owns the
// iron-law guarantees: AI cannot set stage other than 'awaiting_approval',
// AI cannot set approved_by/approved_at/scheduled_at, workspace_id is
// derived from the authenticated context (never from the request body).

import { createClient, SupabaseClient } from "@supabase/supabase-js";
import type { Platform } from "@/lib/types";
import type {
  GeneratedCaption,
  PlanRow,
  ResolvedAspect,
  ContentTypeFromPlan,
  PostInsertRow,
} from "./types";
import { aiAssetProxyUrl } from "./asset-url";

function adminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase admin not configured");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

const PLATFORM_ALIASES: Record<string, Platform> = {
  instagram: "instagram",
  tiktok: "tiktok",
  facebook: "facebook",
  youtube: "youtube",
  "youtube shorts": "youtube",
  youtube_shorts: "youtube",
  linkedin: "linkedin",
};

export function normalizePlanPlatforms(raw: ReadonlyArray<string> | null): Platform[] {
  if (!raw || raw.length === 0) return [];
  const seen = new Set<Platform>();
  const out: Platform[] = [];
  for (const item of raw) {
    if (!item) continue;
    if (item.toLowerCase() === "multi-platform") {
      for (const p of ["instagram", "facebook", "linkedin"] as Platform[]) {
        if (!seen.has(p)) {
          seen.add(p);
          out.push(p);
        }
      }
      continue;
    }
    const norm = PLATFORM_ALIASES[item.toLowerCase()];
    if (norm && !seen.has(norm)) {
      seen.add(norm);
      out.push(norm);
    }
  }
  return out;
}

/** Map plan format → posts.content_type (existing enum). */
export function contentTypeFromPlan(
  mediaType: "image" | "video" | null,
  format: string | null,
): ContentTypeFromPlan {
  if (mediaType === "video") return "reel";
  if (format === "carousel") return "carousel";
  if (format === "story") return "story";
  return "image";
}

export interface BuildPostArgs {
  workspaceId: string;
  actorEmail: string;
  plan: PlanRow;
  caption: GeneratedCaption;
  resolved: ResolvedAspect;
  assets: ReadonlyArray<{ storageKey: string; signedUrl: string }>;
  textModel: string;
  imageModel: string;
  promptVersion: string;
}

export function buildPostInsertRow(args: BuildPostArgs): PostInsertRow {
  const { plan, caption, resolved, assets } = args;
  const platforms = normalizePlanPlatforms(plan.platforms);
  const contentType = contentTypeFromPlan(plan.media_type, plan.format);
  const generatedByModel = `${args.textModel}+${args.imageModel}`;
  const assetUrls = assets.map((a) => aiAssetProxyUrl(a.storageKey));
  const thumb = assetUrls[0] || null;

  return {
    workspace_id: args.workspaceId,
    title: caption.title.slice(0, 120) || (plan.topic ? plan.topic.slice(0, 120) : "AI draft"),
    stage: "awaiting_approval", // iron law — never trust the model
    platforms,
    content_type: contentType,
    thumbnail_url: thumb,
    caption: caption.caption,
    hook: caption.hook,
    notes: null,
    checklist: [],
    feel: plan.feel,
    visual_style: plan.visual_style,
    style_prompt: plan.style_prompt,
    slides_count: plan.slides_count,
    media_type: plan.media_type,
    aspect_ratio: resolved.ratio,
    asset_width: resolved.width,
    asset_height: resolved.height,
    asset_urls: assetUrls,
    asset_storage_keys: assets.map((a) => a.storageKey),
    hashtags: caption.hashtags,
    cta: caption.cta,
    visual_brief: caption.visual_brief,
    carousel_outline: caption.scene_outline,
    source_notes: caption.source_notes,
    quality_score: caption.quality_score,
    approval_notes: caption.approval_notes,
    generated_by_model: generatedByModel,
    prompt_version: args.promptVersion,
    revision_count: 0,
    plan_row_id: plan.id,
    created_by: `ai:${args.actorEmail}`,
    scheduled_date: plan.scheduled_date,
    scheduled_time: plan.scheduled_time,
  };
}

export async function insertGeneratedPost(args: BuildPostArgs): Promise<{ id: string }> {
  const sb = adminClient();
  const row = buildPostInsertRow(args);
  const { data, error } = await sb.from("posts").insert(row).select("id").single();
  if (error || !data) {
    throw new Error(`Insert post failed: ${error?.message || "unknown"}`);
  }
  return { id: data.id as string };
}

export interface UpdateRevisedArgs {
  postId: string;
  workspaceId: string;
  caption: GeneratedCaption;
  resolved: ResolvedAspect;
  assets: ReadonlyArray<{ storageKey: string; signedUrl: string }>;
  textModel: string;
  imageModel: string;
  promptVersion: string;
}

export async function updateRevisedPost(args: UpdateRevisedArgs): Promise<void> {
  const sb = adminClient();

  // Fetch current revision_count so we can increment atomically.
  const { data: current, error: fetchErr } = await sb
    .from("posts")
    .select("revision_count")
    .eq("id", args.postId)
    .eq("workspace_id", args.workspaceId)
    .single();
  if (fetchErr || !current) {
    throw new Error(`Fetch post for revise failed: ${fetchErr?.message || "not found"}`);
  }

  const update = {
    stage: "awaiting_approval", // iron law
    title: args.caption.title.slice(0, 120),
    caption: args.caption.caption,
    hook: args.caption.hook,
    cta: args.caption.cta,
    hashtags: args.caption.hashtags,
    visual_brief: args.caption.visual_brief,
    carousel_outline: args.caption.scene_outline,
    source_notes: args.caption.source_notes,
    quality_score: args.caption.quality_score,
    approval_notes: args.caption.approval_notes,
    asset_urls: args.assets.map((a) => aiAssetProxyUrl(a.storageKey)),
    asset_storage_keys: args.assets.map((a) => a.storageKey),
    asset_width: args.resolved.width,
    asset_height: args.resolved.height,
    thumbnail_url: args.assets[0] ? aiAssetProxyUrl(args.assets[0].storageKey) : null,
    generated_by_model: `${args.textModel}+${args.imageModel}`,
    prompt_version: args.promptVersion,
    revision_count: (current.revision_count || 0) + 1,
  };

  const { error: upErr } = await sb
    .from("posts")
    .update(update)
    .eq("id", args.postId)
    .eq("workspace_id", args.workspaceId);
  if (upErr) throw new Error(`Update revised post failed: ${upErr.message}`);
}
