// Deterministic aspect-ratio resolution for Creator Studio output.
//
// Why pure & re-runnable: aspect ratios are factual platform constraints,
// not creative decisions. The client uses this to render the preview chip;
// the server re-runs it on every generate request to defend against tampering.
//
// Adding a new platform or format means extending the cases below and
// extending the unit-test matrix in __tests__/aspect-resolver.test.ts.

import type { ResolvedAspect, MediaType, StudioFormat } from "./types";

export interface ResolveInput {
  mediaType: MediaType;
  format: StudioFormat;
  platforms: ReadonlyArray<string>;
}

// Platforms that prefer 9:16 portrait when posted natively.
const PORTRAIT_ONLY = new Set(["tiktok", "youtube", "youtube_shorts", "youtube shorts"]);

const isPortraitOnly = (p: string) => PORTRAIT_ONLY.has(p.toLowerCase());

/**
 * Resolve a target aspect ratio + pixel dimensions + OpenAI source size +
 * post-processing instruction from the operator's intent.
 *
 * Rules:
 *  - Video / Reel / Storyboard → always 9:16 (1080×1920)
 *  - Image / Carousel          → always 4:5  (1080×1350 per slide)
 *  - Image / Story             → always 9:16 (1080×1920)
 *  - Image / Single
 *      - All platforms portrait-only → 9:16
 *      - Otherwise (any feed platform involved, including Multi-platform) → 4:5
 */
export function resolveAspect(input: ResolveInput): ResolvedAspect {
  const { mediaType, format, platforms } = input;

  if (mediaType === "video") {
    // Reel and storyboard both render at 9:16.
    return {
      ratio: "9:16",
      width: 1080,
      height: 1920,
      openaiSize: "1024x1536",
      postProcess: "crop_center",
    };
  }

  if (format === "story") {
    return {
      ratio: "9:16",
      width: 1080,
      height: 1920,
      openaiSize: "1024x1536",
      postProcess: "crop_center",
    };
  }

  if (format === "carousel") {
    return {
      ratio: "4:5",
      width: 1080,
      height: 1350,
      openaiSize: "1024x1536",
      postProcess: "crop_center",
    };
  }

  // Image + Single
  const platformsLc = platforms.map((p) => p.toLowerCase());
  const allPortraitOnly =
    platformsLc.length > 0 && platformsLc.every(isPortraitOnly);
  if (allPortraitOnly) {
    return {
      ratio: "9:16",
      width: 1080,
      height: 1920,
      openaiSize: "1024x1536",
      postProcess: "crop_center",
    };
  }

  // Default for Single posts on feed platforms (or multi-platform) → 4:5
  return {
    ratio: "4:5",
    width: 1080,
    height: 1350,
    openaiSize: "1024x1536",
    postProcess: "crop_center",
  };
}

/**
 * Number of distinct images/keyframes the pipeline will produce.
 * The image-postprocess step crops one OpenAI generation per index.
 */
export function imageCountForPlan(
  format: StudioFormat,
  mediaType: MediaType,
  slidesCount: number | null,
): number {
  if (mediaType === "video") {
    // Storyboard mode always produces 4 keyframes. Full reel mode (Phase 2)
    // still produces the storyboard frames as a fallback.
    return 4;
  }
  if (format === "carousel") {
    const n = slidesCount && Number.isFinite(slidesCount) ? slidesCount : 5;
    return Math.max(2, Math.min(10, Math.round(n)));
  }
  return 1;
}

export function formatAspectChip(resolved: ResolvedAspect): string {
  return `${resolved.ratio} · ${resolved.width}×${resolved.height}`;
}
