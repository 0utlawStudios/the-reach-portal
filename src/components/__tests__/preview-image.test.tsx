import { act, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PreviewImage } from "../preview-image";

const FILE_ID = "abcdefghijklmnopqrst";

describe("PreviewImage", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps a slow HEIC thumbnail alive while the full preview starts loading", async () => {
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
      await vi.advanceTimersByTimeAsync(2_501);
    });

    images = Array.from(container.querySelectorAll("img"));
    expect(images).toHaveLength(2);
    expect(images[0]).toHaveAttribute("src", `/api/media/image-preview?id=${FILE_ID}&token=signed&size=thumb`);
    expect(images[1]).toHaveAttribute("src", `/api/media/image-preview?id=${FILE_ID}&token=signed&size=full`);

    await act(async () => {
      fireEvent.load(images[0]);
    });

    images = Array.from(container.querySelectorAll("img"));
    expect(images[0].className).toContain("opacity-100");
    expect(images[1].className).toContain("opacity-0");
  });
});
