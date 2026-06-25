import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockGetSession = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabaseClient", () => ({
  supabase: {
    auth: { getSession: mockGetSession },
  },
}));

import { signedMediaViewUrl } from "@/lib/media-view-url";

const originalFetch = globalThis.fetch;

beforeEach(() => {
  mockGetSession.mockReset();
  mockGetSession.mockResolvedValue({ data: { session: { access_token: "session-token" } } });
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("signedMediaViewUrl", () => {
  it("returns a short-lived signed URL for private media routes", async () => {
    globalThis.fetch = vi.fn(async () => Response.json({
      url: "/api/drive/stream?id=abcdefghijklmnopqrst&token=signed",
    })) as unknown as typeof fetch;

    await expect(signedMediaViewUrl("/api/drive/stream?id=abcdefghijklmnopqrst"))
      .resolves.toBe("/api/drive/stream?id=abcdefghijklmnopqrst&token=signed");
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
