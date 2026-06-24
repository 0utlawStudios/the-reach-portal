import { describe, expect, it } from "vitest";
import { browserImagePreviewUrl, isHeicLikeImage } from "@/lib/image-preview";

const FILE_ID = "abcdefghijklmnopqrst";

describe("image preview routing", () => {
  it("recognizes HEIC and HEIF by MIME or filename", () => {
    expect(isHeicLikeImage("image/heic")).toBe(true);
    expect(isHeicLikeImage("image/heic-sequence")).toBe(true);
    expect(isHeicLikeImage("image/heif")).toBe(true);
    expect(isHeicLikeImage("image/heif-sequence")).toBe(true);
    expect(isHeicLikeImage("", "IMG_1234.HEIC")).toBe(true);
    expect(isHeicLikeImage("image/jpeg", "cover.jpg")).toBe(false);
  });

  it("routes Drive HEIC images through the browser-safe preview converter", () => {
    expect(
      browserImagePreviewUrl(`/api/drive/stream?id=${FILE_ID}&token=signed`, {
        mimeType: "image/heic",
        fileName: "source.heic",
      }),
    ).toBe(`/api/media/image-preview?id=${FILE_ID}&token=signed`);
  });

  it("leaves non-HEIC images and local blobs untouched", () => {
    expect(browserImagePreviewUrl(`/api/drive/stream?id=${FILE_ID}`, { mimeType: "image/jpeg" }))
      .toBe(`/api/drive/stream?id=${FILE_ID}`);
    expect(browserImagePreviewUrl("blob:local-image", { mimeType: "image/heic", fileName: "source.heic" }))
      .toBe("blob:local-image");
  });
});
