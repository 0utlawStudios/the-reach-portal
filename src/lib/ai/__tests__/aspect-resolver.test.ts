// Unit tests for the aspect resolver.
// Run via: `npm test` (vitest).
//
// Covers every row in the resolution table in §2.6 of the build prompt.

import { describe, it, expect } from "vitest";
import { resolveAspect, imageCountForPlan } from "../aspect-resolver";

describe("resolveAspect", () => {
  it("Image / Single / Instagram → 4:5", () => {
    expect(resolveAspect({ mediaType: "image", format: "single", platforms: ["instagram"] })).toEqual({
      ratio: "4:5", width: 1080, height: 1350, openaiSize: "1024x1536", postProcess: "crop_center",
    });
  });
  it("Image / Single / LinkedIn → 4:5", () => {
    expect(resolveAspect({ mediaType: "image", format: "single", platforms: ["linkedin"] }).ratio).toBe("4:5");
  });
  it("Image / Single / Facebook → 4:5", () => {
    expect(resolveAspect({ mediaType: "image", format: "single", platforms: ["facebook"] }).ratio).toBe("4:5");
  });
  it("Image / Single / TikTok → 9:16", () => {
    expect(resolveAspect({ mediaType: "image", format: "single", platforms: ["tiktok"] }).ratio).toBe("9:16");
  });
  it("Image / Single / YouTube Shorts → 9:16", () => {
    expect(resolveAspect({ mediaType: "image", format: "single", platforms: ["youtube"] }).ratio).toBe("9:16");
  });
  it("Image / Single / Multi-platform → 4:5", () => {
    expect(resolveAspect({ mediaType: "image", format: "single", platforms: ["instagram", "linkedin"] }).ratio).toBe("4:5");
  });
  it("Image / Carousel / any → 4:5", () => {
    expect(resolveAspect({ mediaType: "image", format: "carousel", platforms: ["instagram"] }).ratio).toBe("4:5");
    expect(resolveAspect({ mediaType: "image", format: "carousel", platforms: ["tiktok"] }).ratio).toBe("4:5");
  });
  it("Image / Story / any → 9:16", () => {
    expect(resolveAspect({ mediaType: "image", format: "story", platforms: ["instagram"] }).ratio).toBe("9:16");
  });
  it("Video / Reel / any → 9:16", () => {
    expect(resolveAspect({ mediaType: "video", format: "reel", platforms: ["instagram"] }).ratio).toBe("9:16");
  });
  it("Video / Storyboard / any → 9:16", () => {
    expect(resolveAspect({ mediaType: "video", format: "storyboard", platforms: ["facebook"] }).ratio).toBe("9:16");
  });
});

describe("imageCountForPlan", () => {
  it("single → 1", () => expect(imageCountForPlan("single", "image", null)).toBe(1));
  it("story → 1", () => expect(imageCountForPlan("story", "image", null)).toBe(1));
  it("carousel default → 5", () => expect(imageCountForPlan("carousel", "image", null)).toBe(5));
  it("carousel custom → clamped 2..10", () => {
    expect(imageCountForPlan("carousel", "image", 3)).toBe(3);
    expect(imageCountForPlan("carousel", "image", 1)).toBe(2);
    expect(imageCountForPlan("carousel", "image", 99)).toBe(10);
  });
  it("video / reel → 4", () => expect(imageCountForPlan("reel", "video", null)).toBe(4));
  it("video / storyboard → 4", () => expect(imageCountForPlan("storyboard", "video", null)).toBe(4));
});
