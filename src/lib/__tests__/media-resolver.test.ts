import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { driveFileIdFromUrl, resolveCardVideoUrl, thumbnailIsDefinitelyImage } from "../media-resolver";
import type { ContentCard } from "../types";

function card(overrides: Partial<ContentCard>): ContentCard {
  return {
    id: "post-1",
    title: "Post",
    stage: "ideas",
    platforms: ["instagram"],
    contentType: "video",
    thumbnailUrl: "",
    caption: "",
    createdAt: "2026-06-11T00:00:00.000Z",
    updatedAt: "2026-06-11T00:00:00.000Z",
    checklist: [],
    ...overrides,
  };
}

describe("media resolver", () => {
  it("uses the source-vault video file for video playback", () => {
    const c = card({
      thumbnailUrl: "/api/drive/stream?id=thumb-video",
      sourceVault: {
        rawFiles: [{
          name: "clip.mov",
          url: "/api/drive/stream?id=raw-video",
          fileId: "raw-video",
          usageType: "master",
          mimeType: "video/quicktime",
          uploadedAt: "2026-06-11T00:00:00.000Z",
        }],
      },
    });

    expect(resolveCardVideoUrl(c)).toBe("/api/drive/stream?id=raw-video");
  });

  it("prefers optimized playback URLs over publishing source URLs for video UI", () => {
    const c = card({
      thumbnailUrl: "/api/drive/stream?id=poster",
      sourceVault: {
        rawFiles: [{
          name: "clip.mov",
          url: "https://drive.google.com/uc?export=download&id=raw-video",
          publishUrl: "https://drive.google.com/uc?export=download&id=raw-video",
          driveProxyUrl: "/api/drive/stream?id=raw-video&token=signed",
          playbackUrl: "https://project.supabase.co/storage/v1/object/public/media-playback/workspace/post/clip.mov",
          playbackStorageKey: "workspace/post/clip.mov",
          fileId: "raw-video",
          usageType: "master",
          mimeType: "video/quicktime",
          uploadedAt: "2026-06-11T00:00:00.000Z",
        }],
      },
    });

    expect(resolveCardVideoUrl(c)).toBe("https://project.supabase.co/storage/v1/object/public/media-playback/workspace/post/clip.mov");
  });

  it("falls back to thumbnailUrl when a legacy video post stored the video as the thumbnail", () => {
    const c = card({ thumbnailUrl: "/api/drive/stream?id=legacy-video" });

    expect(resolveCardVideoUrl(c)).toBe("/api/drive/stream?id=legacy-video");
  });

  it("treats stored image thumbnail metadata as a reliable poster", () => {
    const c = card({
      thumbnailUrl: "/api/drive/stream?id=poster",
      sourceVault: { thumbnailMimeType: "image/jpeg" },
    });

    expect(thumbnailIsDefinitelyImage(c)).toBe(true);
  });

  it("does not infer image posters from distinct Drive file ids without MIME proof", () => {
    const c = card({
      thumbnailUrl: "/api/drive/stream?id=poster&token=signed",
      sourceVault: {
        rawFiles: [{
          name: "clip.mov",
          url: "https://drive.google.com/uc?export=download&id=raw-video",
          driveProxyUrl: "/api/drive/stream?id=raw-video&token=signed",
          playbackUrl: "https://project.supabase.co/storage/v1/object/public/media-playback/workspace/post/clip.mov",
          fileId: "raw-video",
          usageType: "master",
          mimeType: "video/quicktime",
          uploadedAt: "2026-06-11T00:00:00.000Z",
        }],
      },
    });

    expect(thumbnailIsDefinitelyImage(c)).toBe(false);
  });

  it("does not treat the raw Drive video file as an image poster", () => {
    const c = card({
      thumbnailUrl: "/api/drive/stream?id=raw-video&token=signed",
      sourceVault: {
        thumbnailFileId: "raw-video",
        rawFiles: [{
          name: "clip.mov",
          url: "https://drive.google.com/uc?export=download&id=raw-video",
          fileId: "raw-video",
          usageType: "master",
          mimeType: "video/quicktime",
          uploadedAt: "2026-06-11T00:00:00.000Z",
        }],
      },
    });

    expect(thumbnailIsDefinitelyImage(c)).toBe(false);
  });

  it("extracts Drive stream file ids", () => {
    expect(driveFileIdFromUrl("/api/drive/stream?id=abc123&token=secret")).toBe("abc123");
  });

  it("extracts Drive file ids from standard shared file URLs", () => {
    expect(driveFileIdFromUrl("https://drive.google.com/file/d/abc123/view?usp=sharing")).toBe("abc123");
  });

  it("routes card thumbnails through the shared video-aware renderer across app surfaces", () => {
    const files = [
      "src/components/content-card.tsx",
      "src/components/pages/dashboard-page.tsx",
      "src/components/pages/calendar-page.tsx",
      "src/components/kanban-board.tsx",
      "src/components/pages/post-preview-page.tsx",
      "src/components/repurpose-modal.tsx",
      "src/components/asset-review-drawer.tsx",
    ];

    for (const file of files) {
      const src = readFileSync(join(process.cwd(), file), "utf8");
      expect(src, file).toContain("CardThumbnailMedia");
      expect(src, file).not.toMatch(/RawImage\s+src=\{(?:card|selectedCard)\.thumbnailUrl\}/);
    }
  });

  it("keeps raw file URLs publish-safe instead of storing only the app stream proxy", () => {
    const createPostSrc = readFileSync(join(process.cwd(), "src/components/create-post-modal.tsx"), "utf8");
    const drawerSrc = readFileSync(join(process.cwd(), "src/components/asset-review-drawer.tsx"), "utf8");
    const pickerSrc = readFileSync(join(process.cwd(), "src/components/media-picker.tsx"), "utf8");
    expect(createPostSrc).toContain("const publishUrl = f.publishUrl ||");
    expect(createPostSrc).toContain("url: publishUrl");
    expect(createPostSrc).toContain("driveProxyUrl");
    expect(createPostSrc).toContain("driveFileIdFromUrl(result.driveProxyUrl || result.url)");
    expect(drawerSrc).toContain("const publishUrl = result.publishUrl ||");
    expect(drawerSrc).toContain("url: publishUrl");
    expect(drawerSrc).toContain("playbackUrl");
    expect(drawerSrc).toContain("driveFileIdFromUrl(result.driveProxyUrl || result.url)");
    expect(drawerSrc).toContain('preload={resolvedPosterUrl ? "none" : "metadata"}');
    expect(pickerSrc).toContain("enrichFromRawFile(existing, f)");
    expect(pickerSrc).toContain("selectionFromAsset(selectedAsset)");
    expect(pickerSrc).toContain("missing its Drive publishing source");
  });

  it("keeps playback storage policy enforced by the bucket, not only client metadata", () => {
    const routeSrc = readFileSync(join(process.cwd(), "src/app/api/media/playback-upload/route.ts"), "utf8");
    const migrationSrc = readFileSync(join(process.cwd(), "supabase/migrations/0049_media_playback_bucket.sql"), "utf8");
    expect(routeSrc).toContain("fileSizeLimit: MAX_PLAYBACK_VIDEO_FILE_SIZE");
    expect(routeSrc).toContain("allowedMimeTypes: [...PLAYBACK_VIDEO_MIME_TYPES]");
    expect(routeSrc).toContain("extensionFor(mimeType)");
    expect(migrationSrc).toContain("file_size_limit");
    expect(migrationSrc).toContain("allowed_mime_types");
    expect(migrationSrc).toContain("52428800");
  });
});
