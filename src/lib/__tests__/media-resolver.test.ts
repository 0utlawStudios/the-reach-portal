import { describe, expect, it } from "vitest";
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

  it("extracts Drive stream file ids", () => {
    expect(driveFileIdFromUrl("/api/drive/stream?id=abc123&token=secret")).toBe("abc123");
  });
});
