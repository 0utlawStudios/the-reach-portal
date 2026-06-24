import { describe, expect, it } from "vitest";
import { hasPublishingMedia } from "@/lib/publishing-media";

describe("hasPublishingMedia", () => {
  it("accepts manual raw files as publishable media", () => {
    expect(hasPublishingMedia({
      sourceVault: {
        rawFiles: [{
          name: "post.jpg",
          url: "/api/drive/stream?id=file",
          usageType: "master",
          uploadedAt: "2026-06-25T00:00:00.000Z",
        }],
      },
    })).toBe(true);
  });

  it("accepts AI-generated asset URLs as publishable media", () => {
    expect(hasPublishingMedia({
      sourceVault: { rawFiles: [] },
      assetUrls: ["/api/ai/asset?key=workspace%2Fpost%2Fslide-1.jpg"],
    })).toBe(true);
  });

  it("rejects empty media sources", () => {
    expect(hasPublishingMedia({ sourceVault: { rawFiles: [] }, assetUrls: ["  "] })).toBe(false);
  });
});
