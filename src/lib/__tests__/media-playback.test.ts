import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockGetSession = vi.hoisted(() => vi.fn());
const mockUploadToSignedUrl = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabaseClient", () => ({
  supabase: {
    auth: { getSession: mockGetSession },
    storage: { from: () => ({ uploadToSignedUrl: mockUploadToSignedUrl }) },
  },
}));

import { playbackUploadBudgetMs, uploadVideoPlaybackCopy } from "@/lib/media-playback";

const originalFetch = globalThis.fetch;

function mockTargetFetch() {
  globalThis.fetch = vi.fn(async () => Response.json({
    bucket: "playback",
    storageKey: "media-library/video.mp4",
    token: "signed-token",
    playbackUrl: "/api/media/playback?key=media-library%2Fvideo.mp4",
    mimeType: "video/mp4",
    size: 10,
  })) as unknown as typeof fetch;
}

function makeVideo(name = "video.mp4", bytes = 10) {
  return new File([new Uint8Array(bytes)], name, { type: "video/mp4" });
}

beforeEach(() => {
  mockGetSession.mockReset();
  mockGetSession.mockResolvedValue({ data: { session: { access_token: "test-token" } } });
  mockUploadToSignedUrl.mockReset();
  mockTargetFetch();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("playbackUploadBudgetMs", () => {
  it("scales the budget with file size above a fixed base", () => {
    const base = playbackUploadBudgetMs(0);
    expect(base).toBe(30_000);
    // 40 MiB at the 40 KiB/s floor = 1024s of transfer on top of the base.
    const big = playbackUploadBudgetMs(40 * 1024 * 1024);
    expect(big).toBe(30_000 + 1_024_000);
    expect(playbackUploadBudgetMs(50 * 1024 * 1024)).toBeGreaterThan(big);
  });

  it("never returns a negative or NaN budget for junk input", () => {
    expect(playbackUploadBudgetMs(-5)).toBe(30_000);
    expect(playbackUploadBudgetMs(Number.NaN)).toBe(30_000);
  });
});

describe("uploadVideoPlaybackCopy", () => {
  it("resolves when the signed-url upload succeeds", async () => {
    mockUploadToSignedUrl.mockResolvedValue({ data: { path: "ok" }, error: null });
    const result = await uploadVideoPlaybackCopy(makeVideo());
    expect(result.playbackUrl).toBe("/api/media/playback?key=media-library%2Fvideo.mp4");
    expect(result.playbackStorageKey).toBe("media-library/video.mp4");
  });

  it("fails closed instead of hanging when the signed-url upload never settles", async () => {
    vi.useFakeTimers();
    // Simulate a dead/slow uplink: the upload promise never resolves.
    mockUploadToSignedUrl.mockReturnValue(new Promise(() => {}));
    const pending = uploadVideoPlaybackCopy(makeVideo("stalled.mp4", 10));
    const assertion = expect(pending).rejects.toThrow(/timed out/i);
    await vi.advanceTimersByTimeAsync(playbackUploadBudgetMs(10) + 10);
    await assertion;
  });

  it("fails closed instead of hanging when playback target minting never settles", async () => {
    vi.useFakeTimers();
    globalThis.fetch = vi.fn((_input, init) => new Promise((_resolve, reject) => {
      const signal = (init as RequestInit | undefined)?.signal;
      signal?.addEventListener("abort", () => reject(new Error("aborted")));
    })) as unknown as typeof fetch;

    const pending = uploadVideoPlaybackCopy(makeVideo("target-stalled.mp4", 10));
    const assertion = expect(pending).rejects.toThrow(/target timed out/i);
    await vi.advanceTimersByTimeAsync(15_010);
    await assertion;
    expect(mockUploadToSignedUrl).not.toHaveBeenCalled();
  });
});
