import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MediaVideo } from "../media-video";

describe("MediaVideo", () => {
  afterEach(() => {
    vi.useRealTimers();
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

  it("starts the fallback watchdog once a preload-none video is attempted", async () => {
    vi.useFakeTimers();
    render(
      <MediaVideo
        sources={["/api/drive/stream?id=primary", "/api/drive/stream?id=fallback"]}
        poster="/api/media/image-preview?id=primary&size=thumb"
        preload="none"
        label="Fallback video"
      />,
    );

    const video = screen.getByLabelText("Fallback video");
    fireEvent.loadStart(video);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(45_001);
    });

    expect(screen.getByLabelText("Fallback video")).toHaveAttribute("src", "/api/drive/stream?id=fallback");
  });

  it("waits for a decoded frame instead of treating metadata-only black video as loaded", async () => {
    vi.useFakeTimers();
    render(
      <MediaVideo
        sources={["/api/drive/stream?id=primary", "/api/drive/stream?id=fallback"]}
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

    expect(screen.getByLabelText("Cold video")).toHaveAttribute("src", "/api/drive/stream?id=fallback");
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
});
