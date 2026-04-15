// Per-platform post validator. Pure functions, zero runtime side effects.
// Not yet wired to any UI. Workstream H (content correctness) will wire
// validatePlatforms() into create-post-modal and asset-review-drawer to block
// approval when a selected platform cannot accept the payload.
//
// Limits are best-effort snapshots as of 2026-04-15. Platforms change their
// limits; revisit before relying on these in production.

export type Platform =
  | "instagram"
  | "facebook"
  | "linkedin"
  | "x"
  | "tiktok"
  | "youtube";

export type MediaInput = {
  type: "image" | "video" | "carousel";
  sizeBytes?: number;
  durationSec?: number;
  aspectRatio?: string; // "1:1", "4:5", "9:16", "16:9", etc.
};

export type PostPayload = {
  caption?: string;
  hashtags?: string[];
  media?: MediaInput[];
};

export type ValidationResult = {
  ok: boolean;
  errors: string[];
};

type PlatformConstraints = {
  captionMax: number;
  hashtagMax: number;
  imageMaxBytes: number;
  videoMaxBytes: number;
  videoDurationMaxSec: number;
  carouselMax: number;
  aspectAllow: string[];
};

const MB = 1024 * 1024;
const GB = 1024 * MB;

const CONSTRAINTS: Record<Platform, PlatformConstraints> = {
  instagram: {
    captionMax: 2200,
    hashtagMax: 30,
    imageMaxBytes: 30 * MB,
    videoMaxBytes: 250 * MB,
    videoDurationMaxSec: 90 * 60,
    carouselMax: 10,
    aspectAllow: ["1:1", "4:5", "9:16", "16:9"],
  },
  facebook: {
    captionMax: 63206,
    hashtagMax: 30,
    imageMaxBytes: 10 * MB,
    videoMaxBytes: 10 * GB,
    videoDurationMaxSec: 240 * 60,
    carouselMax: 10,
    aspectAllow: ["1:1", "4:5", "9:16", "16:9"],
  },
  linkedin: {
    captionMax: 3000,
    hashtagMax: 30,
    imageMaxBytes: 10 * MB,
    videoMaxBytes: 5 * GB,
    videoDurationMaxSec: 10 * 60,
    carouselMax: 10,
    aspectAllow: ["1:1", "4:5", "9:16", "16:9"],
  },
  x: {
    captionMax: 280,
    hashtagMax: 10,
    imageMaxBytes: 5 * MB,
    videoMaxBytes: 512 * MB,
    videoDurationMaxSec: 140,
    carouselMax: 4,
    aspectAllow: ["1:1", "4:5", "9:16", "16:9"],
  },
  tiktok: {
    captionMax: 2200,
    hashtagMax: 100,
    imageMaxBytes: 20 * MB,
    videoMaxBytes: 287 * MB,
    videoDurationMaxSec: 10 * 60,
    carouselMax: 35,
    aspectAllow: ["9:16", "1:1", "16:9"],
  },
  youtube: {
    captionMax: 5000,
    hashtagMax: 15,
    imageMaxBytes: 2 * MB,
    videoMaxBytes: 256 * GB,
    videoDurationMaxSec: 12 * 60 * 60,
    carouselMax: 1,
    aspectAllow: ["16:9", "9:16"],
  },
};

/** Validate a single post payload against a single platform's constraints. */
export function validatePlatform(
  platform: Platform,
  payload: PostPayload,
): ValidationResult {
  const constraints = CONSTRAINTS[platform];
  if (!constraints) {
    return { ok: false, errors: [`Unknown platform: ${platform}`] };
  }

  const errors: string[] = [];
  const caption = payload.caption ?? "";
  if (caption.length > constraints.captionMax) {
    errors.push(
      `${platform}: caption too long (${caption.length} > ${constraints.captionMax})`,
    );
  }

  const hashtagCount = (payload.hashtags ?? []).length;
  if (hashtagCount > constraints.hashtagMax) {
    errors.push(
      `${platform}: too many hashtags (${hashtagCount} > ${constraints.hashtagMax})`,
    );
  }

  const media = payload.media ?? [];
  if (media.length > constraints.carouselMax) {
    errors.push(
      `${platform}: too many carousel items (${media.length} > ${constraints.carouselMax})`,
    );
  }

  for (let i = 0; i < media.length; i++) {
    const m = media[i];
    const label = media.length > 1 ? ` (item ${i + 1})` : "";

    if (m.type === "image" && typeof m.sizeBytes === "number") {
      if (m.sizeBytes > constraints.imageMaxBytes) {
        errors.push(
          `${platform}: image too large${label} (${formatBytes(m.sizeBytes)} > ${formatBytes(constraints.imageMaxBytes)})`,
        );
      }
    }

    if (m.type === "video") {
      if (typeof m.sizeBytes === "number" && m.sizeBytes > constraints.videoMaxBytes) {
        errors.push(
          `${platform}: video too large${label} (${formatBytes(m.sizeBytes)} > ${formatBytes(constraints.videoMaxBytes)})`,
        );
      }
      if (
        typeof m.durationSec === "number" &&
        m.durationSec > constraints.videoDurationMaxSec
      ) {
        errors.push(
          `${platform}: video too long${label} (${m.durationSec}s > ${constraints.videoDurationMaxSec}s)`,
        );
      }
    }

    if (m.aspectRatio && !constraints.aspectAllow.includes(m.aspectRatio)) {
      errors.push(
        `${platform}: aspect ratio ${m.aspectRatio}${label} not allowed (allowed: ${constraints.aspectAllow.join(", ")})`,
      );
    }
  }

  return { ok: errors.length === 0, errors };
}

/** Validate a payload against every selected platform. */
export function validatePlatforms(
  platforms: Platform[],
  payload: PostPayload,
): Record<Platform, ValidationResult> {
  const result = {} as Record<Platform, ValidationResult>;
  for (const p of platforms) {
    result[p] = validatePlatform(p, payload);
  }
  return result;
}

/** Returns true if every platform passes validation. */
export function allPlatformsValid(
  platforms: Platform[],
  payload: PostPayload,
): boolean {
  return platforms.every((p) => validatePlatform(p, payload).ok);
}

/** Aggregated error list across every failing platform. */
export function collectPlatformErrors(
  platforms: Platform[],
  payload: PostPayload,
): string[] {
  const errors: string[] = [];
  for (const p of platforms) {
    const r = validatePlatform(p, payload);
    if (!r.ok) errors.push(...r.errors);
  }
  return errors;
}

function formatBytes(bytes: number): string {
  if (bytes >= GB) return `${(bytes / GB).toFixed(1)}GB`;
  if (bytes >= MB) return `${(bytes / MB).toFixed(1)}MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${bytes}B`;
}
