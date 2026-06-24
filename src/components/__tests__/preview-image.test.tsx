import { act, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PreviewImage } from "../preview-image";

const FILE_ID = "abcdefghijklmnopqrst";

describe("PreviewImage", () => {
  afterEach(() => {
    vi.useRealTimers();
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
    expect(images[0]).toHaveAttribute("src", `/api/media/image-preview?id=${FILE_ID}&token=signed&size=thumb`);

    await act(async () => {
      fireEvent.load(images[0]);
    });

    images = Array.from(container.querySelectorAll("img"));
    expect(images).toHaveLength(2);
    expect(images[0]).toHaveAttribute("src", `/api/media/image-preview?id=${FILE_ID}&token=signed&size=thumb`);
    expect(images[1]).toHaveAttribute("src", `/api/media/image-preview?id=${FILE_ID}&token=signed&size=full`);
    expect(images[0].className).toContain("opacity-100");
    expect(images[1].className).toContain("opacity-0");
  });

  it("gives a cold HEIC thumbnail time to render before falling back to full conversion", async () => {
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
      await vi.advanceTimersByTimeAsync(8_999);
    });

    expect(Array.from(container.querySelectorAll("img"))).toHaveLength(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2);
    });

    const images = Array.from(container.querySelectorAll("img"));
    expect(images).toHaveLength(2);
    expect(images[1]).toHaveAttribute("src", `/api/media/image-preview?id=${FILE_ID}&token=signed&size=full`);
  });
});
