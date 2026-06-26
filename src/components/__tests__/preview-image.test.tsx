import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PreviewImage } from "../preview-image";

const FILE_ID = "abcdefghijklmnopqrst";
const mockSignedMediaViewUrl = vi.hoisted(() => vi.fn());
const thumbnailCacheMocks = vi.hoisted(() => ({
  cachedPrivateThumbnailUrl: vi.fn(),
  rememberPrivateThumbnail: vi.fn(),
}));

vi.mock("@/lib/media-view-url", () => ({
  isPrivateMediaRouteUrl: (url: string | null | undefined) => (
    typeof url === "string" &&
    (url.startsWith("/api/drive/stream") || url.startsWith("/api/media/image-preview") || url.startsWith("/api/media/playback"))
  ),
  signedMediaViewUrl: mockSignedMediaViewUrl,
}));

vi.mock("@/lib/private-thumbnail-cache", () => ({
  cachedPrivateThumbnailUrl: thumbnailCacheMocks.cachedPrivateThumbnailUrl,
  isCacheablePrivateThumbnailUrl: (url: string | null | undefined) => (
    typeof url === "string" &&
    url.startsWith("/api/media/image-preview") &&
    url.includes("size=thumb")
  ),
  rememberPrivateThumbnail: thumbnailCacheMocks.rememberPrivateThumbnail,
}));

describe("PreviewImage", () => {
  beforeEach(() => {
    mockSignedMediaViewUrl.mockResolvedValue(null);
    thumbnailCacheMocks.cachedPrivateThumbnailUrl.mockResolvedValue(null);
    thumbnailCacheMocks.rememberPrivateThumbnail.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    mockSignedMediaViewUrl.mockReset();
    thumbnailCacheMocks.cachedPrivateThumbnailUrl.mockReset();
    thumbnailCacheMocks.rememberPrivateThumbnail.mockReset();
  });

  it("shows the HEIC thumbnail before starting the full preview conversion", async () => {
    vi.useFakeTimers();
    const { container } = render(
      <PreviewImage
        src={`/api/drive/stream?id=${FILE_ID}&token=signed`}
        mimeType="image/heic"
        fileName="IMG_3748.HEIC"
        alt="IMG_3748.HEIC"
        className="w-full h-full object-contain"
      />,
    );

    let images = Array.from(container.querySelectorAll("img"));
    expect(images).toHaveLength(1);
    expect(images[0]).toHaveAttribute("src", `/api/media/image-preview?id=${FILE_ID}&size=thumb`);

    await act(async () => {
      fireEvent.load(images[0]);
    });

    images = Array.from(container.querySelectorAll("img"));
    expect(images).toHaveLength(2);
    expect(images[0]).toHaveAttribute("src", `/api/media/image-preview?id=${FILE_ID}&size=thumb`);
    expect(images[1]).toHaveAttribute("src", `/api/media/image-preview?id=${FILE_ID}&size=full`);
    expect(images[0].className).toContain("opacity-100");
    expect(images[1].className).toContain("opacity-0");
  });

  it("starts the full HEIC preview shortly after a cold thumbnail starts", async () => {
    vi.useFakeTimers();
    const { container } = render(
      <PreviewImage
        src={`/api/drive/stream?id=${FILE_ID}&token=signed`}
        mimeType="image/heic"
        fileName="IMG_3748.HEIC"
        alt="IMG_3748.HEIC"
        className="w-full h-full object-contain"
      />,
    );

    expect(Array.from(container.querySelectorAll("img"))).toHaveLength(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_199);
    });

    expect(Array.from(container.querySelectorAll("img"))).toHaveLength(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2);
    });

    const images = Array.from(container.querySelectorAll("img"));
    expect(images).toHaveLength(2);
    expect(images[1]).toHaveAttribute("src", `/api/media/image-preview?id=${FILE_ID}&size=full`);
  });

  it("does not render local HEIC blobs as broken raw browser images", () => {
    const { container } = render(
      <PreviewImage
        src="blob:local-heic"
        mimeType="image/heic"
        fileName="IMG_3748.HEIC"
        alt="IMG_3748.HEIC"
        className="w-full h-full object-cover"
      />,
    );

    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("signs and retries a private image URL before showing the broken icon", async () => {
    mockSignedMediaViewUrl.mockResolvedValue(`/api/media/image-preview?id=${FILE_ID}&size=thumb&token=signed`);

    const { container } = render(
      <PreviewImage
        src={`/api/drive/stream?id=${FILE_ID}`}
        mimeType="image/png"
        fileName="8.png"
        alt="8.png"
        className="w-full h-full object-cover"
      />,
    );

    const img = container.querySelector("img");
    expect(img).toHaveAttribute("src", `/api/media/image-preview?id=${FILE_ID}&size=thumb`);

    await act(async () => {
      fireEvent.error(img!);
    });

    expect(mockSignedMediaViewUrl).toHaveBeenCalledWith(`/api/media/image-preview?id=${FILE_ID}&size=thumb`);
    await waitFor(() => {
      expect(container.querySelector("svg")).toBeNull();
      expect(container.querySelector("img")).toHaveAttribute("src", `/api/media/image-preview?id=${FILE_ID}&size=thumb&token=signed`);
      expect(thumbnailCacheMocks.rememberPrivateThumbnail).toHaveBeenCalledWith(
        `/api/media/image-preview?id=${FILE_ID}&size=thumb`,
        `/api/media/image-preview?id=${FILE_ID}&size=thumb&token=signed`,
      );
    });
  });

  it("starts signing private image URLs before the browser reports a load error", async () => {
    mockSignedMediaViewUrl.mockResolvedValue(`/api/media/image-preview?id=${FILE_ID}&size=thumb&token=signed`);

    const { container } = render(
      <PreviewImage
        src={`/api/drive/stream?id=${FILE_ID}`}
        mimeType="image/png"
        fileName="8.png"
        alt="8.png"
        className="w-full h-full object-cover"
      />,
    );

    expect(container.querySelector("img")).toHaveAttribute("src", `/api/media/image-preview?id=${FILE_ID}&size=thumb`);
    await waitFor(() => {
      expect(mockSignedMediaViewUrl).toHaveBeenCalledWith(`/api/media/image-preview?id=${FILE_ID}&size=thumb`);
      expect(container.querySelector("img")).toHaveAttribute("src", `/api/media/image-preview?id=${FILE_ID}&size=thumb&token=signed`);
    });
  });

  it("shows a cached private thumbnail immediately while the signed URL refreshes in the background", async () => {
    const revoke = vi.fn();
    thumbnailCacheMocks.cachedPrivateThumbnailUrl.mockResolvedValue({
      url: "blob:cached-thumb",
      revoke,
    });
    mockSignedMediaViewUrl.mockResolvedValue(`/api/media/image-preview?id=${FILE_ID}&size=thumb&token=signed`);

    const { container, unmount } = render(
      <PreviewImage
        src={`/api/drive/stream?id=${FILE_ID}`}
        mimeType="image/png"
        fileName="8.png"
        alt="8.png"
        className="w-full h-full object-cover"
      />,
    );

    await waitFor(() => {
      expect(thumbnailCacheMocks.cachedPrivateThumbnailUrl).toHaveBeenCalledWith(`/api/media/image-preview?id=${FILE_ID}&size=thumb`);
      expect(container.querySelector("img")).toHaveAttribute("src", "blob:cached-thumb");
    });
    await waitFor(() => {
      expect(thumbnailCacheMocks.rememberPrivateThumbnail).toHaveBeenCalledWith(
        `/api/media/image-preview?id=${FILE_ID}&size=thumb`,
        `/api/media/image-preview?id=${FILE_ID}&size=thumb&token=signed`,
      );
    });
    unmount();
    expect(revoke).toHaveBeenCalledTimes(1);
  });

  it("shows a light top bar while the full resolution loads over the blurry thumbnail, then hides it", async () => {
    vi.useFakeTimers();
    const { container } = render(
      <PreviewImage
        src={`/api/drive/stream?id=${FILE_ID}&token=signed`}
        mimeType="image/heic"
        fileName="IMG_3748.HEIC"
        alt="IMG_3748.HEIC"
        className="w-full h-full object-contain"
      />,
    );

    // Center-spinner phase (the blurry thumbnail has not loaded yet): no top full-res bar.
    expect(container.querySelector('[role="progressbar"]')).toBeNull();

    const thumb = Array.from(container.querySelectorAll("img"))[0];
    await act(async () => {
      fireEvent.load(thumb);
    });

    // Blurry thumbnail standing in, full resolution still loading -> the light top bar shows.
    const bar = container.querySelector('[role="progressbar"]');
    expect(bar).not.toBeNull();
    expect(bar).toHaveAttribute("aria-label", "Loading full resolution");
    const full = Array.from(container.querySelectorAll("img"))[1];
    expect(full).toHaveAttribute("src", `/api/media/image-preview?id=${FILE_ID}&size=full`);

    await act(async () => {
      fireEvent.load(full);
    });

    // Full resolution loaded -> the bar is gone.
    expect(container.querySelector('[role="progressbar"]')).toBeNull();
  });

  it("never shows the full-res bar on grid thumbnails (object-cover)", async () => {
    const { container } = render(
      <PreviewImage
        src={`/api/drive/stream?id=${FILE_ID}&token=signed`}
        mimeType="image/jpeg"
        fileName="photo.jpg"
        alt="photo.jpg"
        className="w-full h-full object-cover"
      />,
    );
    const thumb = container.querySelector("img")!;
    await act(async () => {
      fireEvent.load(thumb);
    });
    expect(container.querySelector('[role="progressbar"]')).toBeNull();
  });
});
