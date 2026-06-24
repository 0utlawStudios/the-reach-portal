import { afterEach, describe, expect, it, vi } from "vitest";
import { browserImagePreviewUrl, heicImagePreviewUrl, isHeicLikeImage, warmBrowserImagePreview } from "@/lib/image-preview";

const FILE_ID = "abcdefghijklmnopqrst";
const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

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
    const opts = {
      mimeType: "image/heic",
      fileName: "source.heic",
    };

    expect(heicImagePreviewUrl(`/api/drive/stream?id=${FILE_ID}&token=signed`, opts))
      .toBe(`/api/media/image-preview?id=${FILE_ID}&token=signed`);
    expect(browserImagePreviewUrl(`/api/drive/stream?id=${FILE_ID}&token=signed`, opts))
      .toBe(`/api/media/image-preview?id=${FILE_ID}&token=signed`);
    expect(browserImagePreviewUrl(`/api/drive/stream?id=${FILE_ID}&token=signed`, { ...opts, size: "thumb" }))
      .toBe(`/api/media/image-preview?id=${FILE_ID}&token=signed&size=thumb`);
  });

  it("warms browser and server HEIC preview caches after upload", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    warmBrowserImagePreview(`/api/drive/stream?id=${FILE_ID}&token=signed`, {
      mimeType: "image/heic",
      fileName: "source.heic",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      `/api/media/image-preview?id=${FILE_ID}&token=signed`,
      expect.objectContaining({
        method: "GET",
        credentials: "same-origin",
        cache: "force-cache",
      }),
    );
    await Promise.resolve();
  });

  it("leaves non-HEIC images and local blobs untouched", () => {
    expect(browserImagePreviewUrl(`/api/drive/stream?id=${FILE_ID}`, { mimeType: "image/jpeg" }))
      .toBe(`/api/drive/stream?id=${FILE_ID}`);
    expect(browserImagePreviewUrl("blob:local-image", { mimeType: "image/heic", fileName: "source.heic" }))
      .toBe("blob:local-image");
  });
});
