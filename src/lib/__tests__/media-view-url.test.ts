import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockGetSession = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabaseClient", () => ({
  supabase: {
    auth: { getSession: mockGetSession },
  },
}));

import { clearSignedMediaViewUrlCache, isPrivateMediaRouteUrl, resolveViewableMediaUrl, signedMediaViewUrl } from "@/lib/media-view-url";

const originalFetch = globalThis.fetch;

beforeEach(() => {
  clearSignedMediaViewUrlCache();
  mockGetSession.mockReset();
  mockGetSession.mockResolvedValue({ data: { session: { access_token: "session-token" } } });
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("signedMediaViewUrl", () => {
  it("recognizes playback copy URLs as private media routes", () => {
    expect(isPrivateMediaRouteUrl("/api/media/playback?key=00000000-0000-0000-0000-000000000001/videos/clip.mp4")).toBe(true);
    expect(isPrivateMediaRouteUrl("/api/media/playback?id=abcdefghijklmnopqrst")).toBe(false);
  });

  it("returns a short-lived signed URL for private media routes", async () => {
    globalThis.fetch = vi.fn(async () => Response.json({
      url: "/api/drive/stream?id=abcdefghijklmnopqrst&token=signed",
    })) as unknown as typeof fetch;

    await expect(signedMediaViewUrl("/api/drive/stream?id=abcdefghijklmnopqrst"))
      .resolves.toBe("/api/drive/stream?id=abcdefghijklmnopqrst&token=signed");
  });

  it("returns a short-lived signed URL for playback media routes", async () => {
    globalThis.fetch = vi.fn(async () => Response.json({
      url: "/api/media/playback?key=00000000-0000-0000-0000-000000000001%2Fvideos%2Fclip.mp4&token=signed",
    })) as unknown as typeof fetch;

    await expect(resolveViewableMediaUrl("/api/media/playback?key=00000000-0000-0000-0000-000000000001/videos/clip.mp4"))
      .resolves.toBe("/api/media/playback?key=00000000-0000-0000-0000-000000000001%2Fvideos%2Fclip.mp4&token=signed");
  });

  it("throws for private copy/open URLs when signing is unavailable", async () => {
    mockGetSession.mockResolvedValueOnce({ data: { session: null } });

    await expect(resolveViewableMediaUrl("/api/drive/stream?id=abcdefghijklmnopqrst"))
      .rejects.toThrow("Could not create a short-lived media link");
  });

  it("does not hang when the auth session lookup stalls", async () => {
    vi.useFakeTimers();
    mockGetSession.mockImplementationOnce(() => new Promise(() => {}));

    const pending = signedMediaViewUrl("/api/drive/stream?id=abcdefghijklmnopqrst");
    const assertion = expect(pending).resolves.toBeNull();
    await vi.advanceTimersByTimeAsync(3_010);
    await assertion;
  });

  it("fails closed instead of hanging when the signer request stalls", async () => {
    vi.useFakeTimers();
    globalThis.fetch = vi.fn((_url, init) => new Promise<Response>((_resolve, reject) => {
      const signal = (init as RequestInit | undefined)?.signal;
      signal?.addEventListener("abort", () => reject(new Error("aborted")));
    })) as unknown as typeof fetch;

    const pending = signedMediaViewUrl("/api/media/image-preview?id=abcdefghijklmnopqrst&size=thumb");
    const assertion = expect(pending).resolves.toBeNull();
    await vi.advanceTimersByTimeAsync(8_010);
    await assertion;
  });
});
