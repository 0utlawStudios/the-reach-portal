// Shared types for the AI generation pipeline.
// Server-only consumers should import these directly; client-only consumers
// should only touch the row/plan shapes here (no OpenAI specifics).

import type { Platform, PipelineStage } from "@/lib/types";

export type MediaType = "image" | "video";

export type StudioFormat =
  | "single"
  | "carousel"
  | "story"
  | "reel"
  | "storyboard";

export type AspectRatio = "1:1" | "4:5" | "9:16" | "1.91:1";

export type OpenAISize = "1024x1024" | "1024x1536" | "1536x1024";

export type AspectPostProcess = "none" | "crop_center" | "crop_top" | "pad";

export interface ResolvedAspect {
  ratio: AspectRatio;
  width: number;
  height: number;
  openaiSize: OpenAISize;
  postProcess: AspectPostProcess;
}

export type StudioFeel =
  | "Educational"
  | "Story"
  | "Founder POV"
  | "Before/After"
  | "Contrarian"
  | "Hype"
  | "Behind-the-Scenes"
  | "Testimonial-Style"
  | "Announcement"
  | "How-To";

export type StudioVisualStyle =
  | "Photography (Realistic)"
  | "Illustration (Flat)"
  | "Infographic"
  | "Screenshot Mockup"
  | "3D Render"
  | "Mixed Media"
  | "Editorial Photo"
  | "Studio Photo";

export type PlanRowStatus =
  | "empty"
  | "ready"
  | "generating"
  | "generated"
  | "failed"
  | "revising";

export interface PlanRow {
  id: string;
  workspace_id: string;
  created_by: string;
  row_index: number;
  scheduled_date: string | null;
  scheduled_time: string | null;
  platforms: string[] | null;
  media_type: MediaType | null;
  format: StudioFormat | null;
  slides_count: number | null;
  resolved_aspect: AspectRatio | null;
  feel: StudioFeel | string | null;
  visual_style: StudioVisualStyle | string | null;
  style_prompt: string | null;
  topic: string | null;
  notes: string | null;
  status: PlanRowStatus;
  generated_post_id: string | null;
  last_error: string | null;
  cost_usd: number | null;
  created_at: string;
  updated_at: string;
}

export type StudioJobKind = "generate" | "revise";
export type StudioJobStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface AiJobRow {
  id: string;
  workspace_id: string;
  kind: StudioJobKind;
  status: StudioJobStatus;
  plan_row_id: string | null;
  post_id: string | null;
  requested_by: string | null;
  payload: Record<string, unknown>;
  result: Record<string, unknown> | null;
  error: string | null;
  cost_usd: number | null;
  created_at: string;
  completed_at: string | null;
}

// ─── OpenAI-shaped types ───

export interface GeneratedCaption {
  title: string;
  hook: string;
  caption: string;
  cta: string;
  hashtags: string[];
  approval_notes: string;
  quality_score: number;
  visual_brief: string;
  /**
   * One entry per slide for carousels (length === slides_count).
   * For reels/storyboard, one entry per keyframe (length === 4).
   * For single/story, length === 1.
   */
  scene_outline: SceneOutline[];
  source_notes: string[];
}

export interface SceneOutline {
  index: number;
  shot: string;          // Description of what the image should show
  on_screen_text: string; // Text overlay (or "" to mean none)
  voiceover?: string;    // Optional, only used for reel/storyboard
}

export type AIWriterRole =
  | "superadmin"
  | "admin"
  | "owner"
  | "creative_director"
  | "social_media_specialist";

export const AI_WRITER_ROLES: ReadonlyArray<AIWriterRole> = [
  "superadmin",
  "admin",
  "owner",
  "creative_director",
  "social_media_specialist",
];

export interface BrandPlaybookData {
  tagline?: string;
  brandVoice?: string;
  website?: string;
  phone?: string;
  contentPillars?: string[];
  hashtagCore?: string[];
  hashtagSeasonal?: string[];
  hashtagEngagement?: string[];
  hashtagCommercial?: string[];
  hooks?: string[];
  ctas?: string[];
  whenToPost?: Record<string, string> | string;
  doFocus?: string[];
  doAvoid?: string[];
}

export interface BrandPlaybookRow {
  id: string;
  workspace_id: string;
  data: BrandPlaybookData;
}

export interface BuildPromptContext {
  brand: BrandPlaybookRow | null;
  recentPosts: Array<{ hook?: string | null; caption?: string | null; title?: string | null }>;
  plan: PlanRow;
  resolved: ResolvedAspect;
  reviseFromPost?: {
    title: string;
    hook: string | null;
    caption: string | null;
    cta: string | null;
    hashtags: string[] | null;
    visual_brief: string | null;
    carousel_outline: unknown;
  };
  reviewerNotes?: string;
}

export type ContentTypeFromPlan =
  | "image"
  | "carousel"
  | "story"
  | "reel"
  | "video";

export interface GenerationResultPayload {
  caption: GeneratedCaption;
  resolved: ResolvedAspect;
  storageKeys: string[];
  signedUrls: string[];
  width: number;
  height: number;
  mediaType: MediaType;
  contentType: ContentTypeFromPlan;
  model: { text: string; image: string; verifier: string };
  promptVersion: string;
  tokensIn: number;
  tokensOut: number;
  imagesGenerated: number;
  costUsd: number;
  latencyMs: number;
}

export type PostInsertRow = {
  id?: string;
  workspace_id: string;
  title: string;
  stage: PipelineStage;
  platforms: Platform[];
  content_type: string;
  thumbnail_url: string | null;
  caption: string | null;
  hook: string | null;
  notes: string | null;
  checklist: unknown[];
  feel: string | null;
  visual_style: string | null;
  style_prompt: string | null;
  slides_count: number | null;
  media_type: MediaType | null;
  aspect_ratio: AspectRatio | null;
  asset_width: number | null;
  asset_height: number | null;
  asset_urls: string[] | null;
  asset_storage_keys: string[] | null;
  hashtags: string[] | null;
  cta: string | null;
  visual_brief: string | null;
  carousel_outline: unknown;
  source_notes: unknown;
  quality_score: number | null;
  approval_notes: string | null;
  generated_by_model: string | null;
  prompt_version: string | null;
  revision_count: number;
  plan_row_id: string | null;
  created_by: string;
  scheduled_date: string | null;
  scheduled_time: string | null;
};
