// Unit tests for the aspect resolver. Lightweight — uses node:test so we
// don't need to add a test runner dep. Run via: `node --test --import tsx src/lib/ai/__tests__/aspect-resolver.test.ts`
//
// Covers every row in the resolution table in §2.6 of the build prompt.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveAspect, imageCountForPlan } from "../aspect-resolver";

describe("resolveAspect", () => {
  it("Image / Single / Instagram → 4:5", () => {
    assert.deepEqual(resolveAspect({ mediaType: "image", format: "single", platforms: ["instagram"] }), {
      ratio: "4:5", width: 1080, height: 1350, openaiSize: "1024x1536", postProcess: "crop_center",
    });
  });
  it("Image / Single / LinkedIn → 4:5", () => {
    assert.equal(resolveAspect({ mediaType: "image", format: "single", platforms: ["linkedin"] }).ratio, "4:5");
  });
  it("Image / Single / Facebook → 4:5", () => {
    assert.equal(resolveAspect({ mediaType: "image", format: "single", platforms: ["facebook"] }).ratio, "4:5");
  });
  it("Image / Single / TikTok → 9:16", () => {
    assert.equal(resolveAspect({ mediaType: "image", format: "single", platforms: ["tiktok"] }).ratio, "9:16");
  });
  it("Image / Single / YouTube Shorts → 9:16", () => {
    assert.equal(resolveAspect({ mediaType: "image", format: "single", platforms: ["youtube"] }).ratio, "9:16");
  });
  it("Image / Single / Multi-platform → 4:5", () => {
    assert.equal(resolveAspect({ mediaType: "image", format: "single", platforms: ["instagram", "linkedin"] }).ratio, "4:5");
  });
  it("Image / Carousel / any → 4:5", () => {
    assert.equal(resolveAspect({ mediaType: "image", format: "carousel", platforms: ["instagram"] }).ratio, "4:5");
    assert.equal(resolveAspect({ mediaType: "image", format: "carousel", platforms: ["tiktok"] }).ratio, "4:5");
  });
  it("Image / Story / any → 9:16", () => {
    assert.equal(resolveAspect({ mediaType: "image", format: "story", platforms: ["instagram"] }).ratio, "9:16");
  });
  it("Video / Reel / any → 9:16", () => {
    assert.equal(resolveAspect({ mediaType: "video", format: "reel", platforms: ["instagram"] }).ratio, "9:16");
  });
  it("Video / Storyboard / any → 9:16", () => {
    assert.equal(resolveAspect({ mediaType: "video", format: "storyboard", platforms: ["facebook"] }).ratio, "9:16");
  });
});

describe("imageCountForPlan", () => {
  it("single → 1", () => assert.equal(imageCountForPlan("single", "image", null), 1));
  it("story → 1", () => assert.equal(imageCountForPlan("story", "image", null), 1));
  it("carousel default → 5", () => assert.equal(imageCountForPlan("carousel", "image", null), 5));
  it("carousel custom → clamped 2..10", () => {
    assert.equal(imageCountForPlan("carousel", "image", 3), 3);
    assert.equal(imageCountForPlan("carousel", "image", 1), 2);
    assert.equal(imageCountForPlan("carousel", "image", 99), 10);
  });
  it("video / reel → 4", () => assert.equal(imageCountForPlan("reel", "video", null), 4));
  it("video / storyboard → 4", () => assert.equal(imageCountForPlan("storyboard", "video", null), 4));
});
