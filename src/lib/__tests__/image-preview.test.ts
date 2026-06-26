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
      .toBe(`/api/media/image-preview?id=${FILE_ID}`);
    expect(browserImagePreviewUrl(`/api/drive/stream?id=${FILE_ID}&token=signed`, opts))
      .toBe(`/api/media/image-preview?id=${FILE_ID}`);
    expect(browserImagePreviewUrl(`/api/drive/stream?id=${FILE_ID}&token=signed`, { ...opts, size: "thumb" }))
      .toBe(`/api/media/image-preview?id=${FILE_ID}&size=thumb`);
  });

  it("warms browser and server HEIC preview caches after upload", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    warmBrowserImagePreview(`/api/drive/stream?id=${FILE_ID}&token=signed`, {
      mimeType: "image/heic",
      fileName: "source.heic",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      `/api/media/image-preview?id=${FILE_ID}&size=thumb`,
      expect.objectContaining({
        method: "GET",
        credentials: "same-origin",
        cache: "force-cache",
      }),
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/media/image-preview?id=${FILE_ID}`,
      expect.objectContaining({
        method: "GET",
        credentials: "same-origin",
        cache: "force-cache",
      }),
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("warms only the requested HEIC preview size when size is explicit", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    warmBrowserImagePreview(`/api/drive/stream?id=${FILE_ID}&token=signed`, {
      mimeType: "image/heic",
      fileName: "source.heic",
      size: "thumb",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      `/api/media/image-preview?id=${FILE_ID}&size=thumb`,
      expect.objectContaining({
        method: "GET",
        credentials: "same-origin",
        cache: "force-cache",
      }),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await Promise.resolve();
  });

  it("warms standard Drive image thumbnails when requested explicitly", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    warmBrowserImagePreview(`/api/drive/stream?id=${FILE_ID}&token=signed`, {
      mimeType: "image/jpeg",
      fileName: "cover.jpg",
      size: "thumb",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      `/api/media/image-preview?id=${FILE_ID}&size=thumb`,
      expect.objectContaining({
        method: "GET",
        credentials: "same-origin",
        cache: "force-cache",
      }),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("routes standard Drive image thumbnails through the browser-safe preview path", () => {
    expect(browserImagePreviewUrl(`/api/drive/stream?id=${FILE_ID}`, { mimeType: "image/jpeg" }))
      .toBe(`/api/drive/stream?id=${FILE_ID}`);
    expect(browserImagePreviewUrl(`/api/drive/stream?id=${FILE_ID}`, { mimeType: "image/jpeg", size: "thumb" }))
      .toBe(`/api/media/image-preview?id=${FILE_ID}&size=thumb`);
    expect(browserImagePreviewUrl(`/api/drive/stream?id=${FILE_ID}`, { mimeType: "image/jpeg", size: "full" }))
      .toBe(`/api/drive/stream?id=${FILE_ID}`);
  });

  it("routes Drive videos to a cached poster thumbnail instead of a live stream", () => {
    // A video cell asks for a thumb -> the image-preview poster (Drive's generated frame),
    // so the grid renders a cached image, not a <video> that re-fetches every refresh.
    expect(browserImagePreviewUrl(`/api/drive/stream?id=${FILE_ID}`, { mimeType: "video/quicktime", size: "thumb" }))
      .toBe(`/api/media/image-preview?id=${FILE_ID}&size=thumb`);
    expect(browserImagePreviewUrl(`/api/drive/stream?id=${FILE_ID}`, { mimeType: "video/mp4", fileName: "clip.mp4", size: "thumb" }))
      .toBe(`/api/media/image-preview?id=${FILE_ID}&size=thumb`);
    // A bare .MOV filename (no explicit mime) still resolves to a poster.
    expect(browserImagePreviewUrl(`/api/drive/stream?id=${FILE_ID}`, { fileName: "IMG_3714.MOV", size: "thumb" }))
      .toBe(`/api/media/image-preview?id=${FILE_ID}&size=thumb`);
    // There is no full-size image for a video, so the full path leaves the raw URL untouched.
    expect(browserImagePreviewUrl(`/api/drive/stream?id=${FILE_ID}`, { mimeType: "video/quicktime", size: "full" }))
      .toBe(`/api/drive/stream?id=${FILE_ID}`);
  });

  it("leaves local blobs untouched", () => {
    expect(browserImagePreviewUrl("blob:local-image", { mimeType: "image/heic", fileName: "source.heic" }))
      .toBe("blob:local-image");
  });
});
