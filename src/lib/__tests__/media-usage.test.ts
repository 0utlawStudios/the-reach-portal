import { describe, expect, it } from "vitest";
import {
  getAutomaticMediaUsage,
  hasManualUsedTag,
  MEDIA_MANUAL_USED_TAG,
  sameUsedIn,
  stripPrivateMediaToken,
  syncedUsedInValue,
  videoPreviewFrameUrl,
} from "../media-usage";
import type { ContentCard, MediaAsset } from "../types";

function card(overrides: Partial<ContentCard>): ContentCard {
  return {
    id: "11111111-1111-4111-8111-111111111111",
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

function asset(overrides: Partial<MediaAsset>): MediaAsset {
  return {
    id: "asset-1",
    name: "clip.mp4",
    url: "/api/drive/stream?id=drive-file-1",
    type: "video",
    folder: "Media Library",
    uploadedAt: "2026-06-11T00:00:00.000Z",
    ...overrides,
  };
}

describe("media usage detection", () => {
  it("detects a Media Library upload later used in a card through Drive URL aliases", () => {
    const media = asset({ url: "/api/drive/stream?id=drive-file-1" });
    const c = card({
      sourceVault: {
        rawFiles: [{
          name: "clip.mp4",
          url: "https://drive.google.com/uc?export=download&id=drive-file-1",
          publishUrl: "https://drive.google.com/uc?export=download&id=drive-file-1",
          usageType: "master",
          mimeType: "video/mp4",
          uploadedAt: "2026-06-11T00:00:00.000Z",
        }],
      },
    });

    expect(getAutomaticMediaUsage(media, [c]).map((item) => item.id)).toEqual([c.id]);
  });

  it("detects a direct card upload whose library row stores the optimized playback URL", () => {
    const playbackUrl = "/api/media/playback?key=workspace%2Fpost%2Fclip.mp4";
    const media = asset({ url: playbackUrl });
    const c = card({
      sourceVault: {
        rawFiles: [{
          name: "clip.mp4",
          url: "https://drive.google.com/uc?export=download&id=drive-file-2",
          playbackUrl,
          usageType: "master",
          mimeType: "video/mp4",
          uploadedAt: "2026-06-11T00:00:00.000Z",
        }],
      },
    });

    expect(getAutomaticMediaUsage(media, [c])).toHaveLength(1);
  });

  it("uses card mediaIds as the strongest link when an asset is selected from the library", () => {
    const media = asset({ id: "media-row-123", url: "https://cdn.example.com/changed-url.mp4" });
    const c = card({ mediaIds: ["media-row-123"], sourceVault: { rawFiles: [] } });

    expect(getAutomaticMediaUsage(media, [c])).toHaveLength(1);
  });

  it("syncs used_in to automatic card ids while preserving manual used tags", () => {
    const c = card({});
    const next = syncedUsedInValue(
      [MEDIA_MANUAL_USED_TAG, "22222222-2222-4222-8222-222222222222"],
      [c],
    );

    expect(next).toEqual([MEDIA_MANUAL_USED_TAG, c.id].sort());
    expect(hasManualUsedTag(next)).toBe(true);
    expect(sameUsedIn(next, [c.id, MEDIA_MANUAL_USED_TAG])).toBe(true);
  });

  it("requests a real video frame for thumbnail previews without changing playback URLs elsewhere", () => {
    expect(videoPreviewFrameUrl("/api/drive/stream?id=abc")).toBe("/api/drive/stream?id=abc#t=0.1");
    expect(videoPreviewFrameUrl("/api/drive/stream?id=abc#t=0.1")).toBe("/api/drive/stream?id=abc#t=0.1");
  });

  it("strips copied private Drive stream tokens while leaving playback keys intact", () => {
    expect(stripPrivateMediaToken("/api/drive/stream?id=abc&token=secret#t=0.1"))
      .toBe("/api/drive/stream?id=abc#t=0.1");
    expect(stripPrivateMediaToken("https://thereach.ten80ten.com/api/media/image-preview?id=abc&token=secret&size=thumb"))
      .toBe("https://thereach.ten80ten.com/api/media/image-preview?id=abc&size=thumb");
    expect(stripPrivateMediaToken("/api/media/playback?key=workspace%2Fclip.mp4"))
      .toBe("/api/media/playback?key=workspace%2Fclip.mp4");
  });
});
