import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MediaVideo } from "../media-video";

const mockSignedMediaViewUrl = vi.hoisted(() => vi.fn());

vi.mock("@/lib/media-view-url", () => ({
  isPrivateMediaRouteUrl: (url: string | null | undefined) => (
    typeof url === "string" &&
    (url.startsWith("/api/drive/stream") || url.startsWith("/api/media/image-preview"))
  ),
  signedMediaViewUrl: mockSignedMediaViewUrl,
}));

describe("MediaVideo", () => {
  beforeEach(() => {
    mockSignedMediaViewUrl.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.useRealTimers();
    mockSignedMediaViewUrl.mockReset();
  });

  it("does not fail a poster-backed preload-none video before the user starts it", async () => {
    vi.useFakeTimers();
    render(
      <MediaVideo
        sources={["/api/drive/stream?id=video"]}
        poster="/api/media/image-preview?id=video&size=thumb"
        preload="none"
        label="Launch video"
      />,
    );

    expect(screen.getByLabelText("Launch video")).toHaveAttribute("src", "/api/drive/stream?id=video");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    expect(screen.queryByText("Video preview unavailable")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Launch video")).toHaveAttribute("src", "/api/drive/stream?id=video");
  });

  it("pre-signs a private preload-none video without starting the fallback watchdog", async () => {
    vi.useFakeTimers();
    mockSignedMediaViewUrl.mockResolvedValue("/api/drive/stream?id=video&token=signed");

    render(
      <MediaVideo
        sources={["/api/drive/stream?id=video"]}
        poster="/api/media/image-preview?id=video&size=thumb"
        preload="none"
        label="Launch signed video"
      />,
    );

    await act(async () => {});

    expect(mockSignedMediaViewUrl).toHaveBeenCalledWith("/api/drive/stream?id=video");
    expect(screen.getByLabelText("Launch signed video")).toHaveAttribute("src", "/api/drive/stream?id=video&token=signed");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(45_001);
    });

    expect(screen.queryByText("Video preview unavailable")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Launch signed video")).toHaveAttribute("src", "/api/drive/stream?id=video&token=signed");
  });

  it("starts the fallback watchdog once a preload-none video is attempted", async () => {
    vi.useFakeTimers();
    render(
      <MediaVideo
        sources={["/media/primary.mp4", "/media/fallback.mp4"]}
        poster="/media/poster.jpg"
        preload="none"
        label="Fallback video"
      />,
    );

    const video = screen.getByLabelText("Fallback video");
    fireEvent.loadStart(video);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(45_001);
    });
    await act(async () => {});

    expect(screen.getByLabelText("Fallback video")).toHaveAttribute("src", "/media/fallback.mp4");
  });

  it("waits for a decoded frame instead of treating metadata-only black video as loaded", async () => {
    vi.useFakeTimers();
    render(
      <MediaVideo
        sources={["/media/primary.mp4", "/media/fallback.mp4"]}
        preload="metadata"
        label="Cold video"
      />,
    );

    const video = screen.getByLabelText("Cold video");
    fireEvent.loadStart(video);
    fireEvent.loadedMetadata(video);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(45_001);
    });
    await act(async () => {});

    expect(screen.getByLabelText("Cold video")).toHaveAttribute("src", "/media/fallback.mp4");
  });

  it("falls back when private signed recovery returns no URL", async () => {
    mockSignedMediaViewUrl.mockResolvedValue(null);

    render(
      <MediaVideo
        sources={["/api/drive/stream?id=primary", "/api/drive/stream?id=fallback"]}
        preload="metadata"
        label="Private recovery miss"
        loadTimeoutMs={1}
      />,
    );

    fireEvent.loadStart(screen.getByLabelText("Private recovery miss"));

    await waitFor(() => {
      expect(screen.getByLabelText("Private recovery miss")).toHaveAttribute("src", "/api/drive/stream?id=fallback");
    });
  });

  it("stops the fallback watchdog once a frame is decoded", async () => {
    vi.useFakeTimers();
    render(
      <MediaVideo
        sources={["/api/drive/stream?id=primary", "/api/drive/stream?id=fallback"]}
        preload="metadata"
        label="Decoded video"
      />,
    );

    const video = screen.getByLabelText("Decoded video");
    fireEvent.loadStart(video);
    fireEvent.loadedData(video);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(45_001);
    });

    expect(screen.getByLabelText("Decoded video")).toHaveAttribute("src", "/api/drive/stream?id=primary");
  });

  it("signs and retries a private video URL before skipping to the next source", async () => {
    mockSignedMediaViewUrl.mockResolvedValueOnce("/api/drive/stream?id=primary&token=signed");

    render(
      <MediaVideo
        sources={["/api/drive/stream?id=primary", "/api/drive/stream?id=fallback"]}
        preload="metadata"
        label="Signed retry video"
      />,
    );

    const video = screen.getByLabelText("Signed retry video");
    fireEvent.error(video);

    expect(mockSignedMediaViewUrl).toHaveBeenCalledWith("/api/drive/stream?id=primary");
    await waitFor(() => {
      expect(screen.getByLabelText("Signed retry video")).toHaveAttribute("src", "/api/drive/stream?id=primary&token=signed");
    });
  });
});
