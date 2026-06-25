import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PreviewImage } from "../preview-image";

const FILE_ID = "abcdefghijklmnopqrst";
const mockSignedMediaViewUrl = vi.hoisted(() => vi.fn());

vi.mock("@/lib/media-view-url", () => ({
  isPrivateMediaRouteUrl: (url: string | null | undefined) => (
    typeof url === "string" &&
    (url.startsWith("/api/drive/stream") || url.startsWith("/api/media/image-preview"))
  ),
  signedMediaViewUrl: mockSignedMediaViewUrl,
}));

describe("PreviewImage", () => {
  beforeEach(() => {
    mockSignedMediaViewUrl.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.useRealTimers();
    mockSignedMediaViewUrl.mockReset();
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
    mockSignedMediaViewUrl.mockResolvedValue(`/api/drive/stream?id=${FILE_ID}&token=signed`);

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
    expect(img).toHaveAttribute("src", `/api/drive/stream?id=${FILE_ID}`);

    await act(async () => {
      fireEvent.error(img!);
    });

    expect(mockSignedMediaViewUrl).toHaveBeenCalledWith(`/api/drive/stream?id=${FILE_ID}`);
    await waitFor(() => {
      expect(container.querySelector("svg")).toBeNull();
      expect(container.querySelector("img")).toHaveAttribute("src", `/api/drive/stream?id=${FILE_ID}&token=signed`);
    });
  });

  it("starts signing private image URLs before the browser reports a load error", async () => {
    mockSignedMediaViewUrl.mockResolvedValue(`/api/drive/stream?id=${FILE_ID}&token=signed`);

    const { container } = render(
      <PreviewImage
        src={`/api/drive/stream?id=${FILE_ID}`}
        mimeType="image/png"
        fileName="8.png"
        alt="8.png"
        className="w-full h-full object-cover"
      />,
    );

    expect(container.querySelector("img")).toHaveAttribute("src", `/api/drive/stream?id=${FILE_ID}`);
    await waitFor(() => {
      expect(mockSignedMediaViewUrl).toHaveBeenCalledWith(`/api/drive/stream?id=${FILE_ID}`);
      expect(container.querySelector("img")).toHaveAttribute("src", `/api/drive/stream?id=${FILE_ID}&token=signed`);
    });
  });
});
