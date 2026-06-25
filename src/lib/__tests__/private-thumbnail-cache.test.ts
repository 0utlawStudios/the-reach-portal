import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockGetMediaViewSessionContext = vi.hoisted(() => vi.fn());

vi.mock("@/lib/media-view-url", () => ({
  getMediaViewSessionContext: mockGetMediaViewSessionContext,
}));

import {
  cachedPrivateThumbnailUrl,
  isCacheablePrivateThumbnailUrl,
  rememberPrivateThumbnail,
} from "@/lib/private-thumbnail-cache";

const originalFetch = globalThis.fetch;
const originalCreateObjectUrl = URL.createObjectURL;
const originalRevokeObjectUrl = URL.revokeObjectURL;

type MemoryCache = {
  delete: ReturnType<typeof vi.fn>;
  match: ReturnType<typeof vi.fn>;
  put: ReturnType<typeof vi.fn>;
};

const stores = new Map<string, Map<string, Response>>();
const memoryCaches = new Map<string, MemoryCache>();

beforeEach(() => {
  stores.clear();
  memoryCaches.clear();
  mockGetMediaViewSessionContext.mockReset();
  mockGetMediaViewSessionContext.mockResolvedValue({
    accessToken: "session-token",
    userId: "user-a",
  });

  Object.defineProperty(globalThis, "caches", {
    configurable: true,
    value: {
      open: vi.fn(async (name: string) => {
        if (!stores.has(name)) stores.set(name, new Map());
        if (!memoryCaches.has(name)) {
          memoryCaches.set(name, {
            match: vi.fn(async (request: Request) => stores.get(name)?.get(request.url)?.clone() || undefined),
            put: vi.fn(async (request: Request, response: Response) => {
              stores.get(name)?.set(request.url, response.clone());
            }),
            delete: vi.fn(async (request: Request) => Boolean(stores.get(name)?.delete(request.url))),
          });
        }
        return memoryCaches.get(name);
      }),
      delete: vi.fn(async (name: string) => stores.delete(name)),
    },
  });
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: vi.fn(() => "blob:cached-thumbnail"),
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: vi.fn(),
  });
  globalThis.fetch = vi.fn(async () => new Response(new Blob(["jpeg"], { type: "image/jpeg" }), {
    status: 200,
    headers: { "Content-Type": "image/jpeg" },
  })) as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: originalCreateObjectUrl,
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: originalRevokeObjectUrl,
  });
  Reflect.deleteProperty(globalThis, "caches");
  vi.restoreAllMocks();
});

describe("private thumbnail cache", () => {
  it("only accepts private image thumbnail preview URLs", () => {
    expect(isCacheablePrivateThumbnailUrl("/api/media/image-preview?id=abcdefghijklmnopqrst&size=thumb")).toBe(true);
    expect(isCacheablePrivateThumbnailUrl("/api/media/image-preview?id=abcdefghijklmnopqrst&size=thumb&token=signed")).toBe(true);
    expect(isCacheablePrivateThumbnailUrl("/api/media/image-preview?id=abcdefghijklmnopqrst&size=full")).toBe(false);
    expect(isCacheablePrivateThumbnailUrl("/api/drive/stream?id=abcdefghijklmnopqrst")).toBe(false);
    expect(isCacheablePrivateThumbnailUrl("/api/media/playback?key=workspace/videos/clip.mp4")).toBe(false);
  });

  it("stores a signed thumbnail response under a tokenless user-scoped cache key", async () => {
    await rememberPrivateThumbnail(
      "/api/media/image-preview?id=abcdefghijklmnopqrst&size=thumb",
      "/api/media/image-preview?id=abcdefghijklmnopqrst&size=thumb&token=signed",
    );

    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/api/media/image-preview?id=abcdefghijklmnopqrst&size=thumb&token=signed",
      expect.objectContaining({
        credentials: "same-origin",
        cache: "no-store",
      }),
    );

    const storedKeys = Array.from(stores.values()).flatMap((store) => Array.from(store.keys()));
    expect(storedKeys).toHaveLength(1);
    expect(storedKeys[0]).toContain("scope=user-a");
    expect(storedKeys[0]).not.toContain("token=signed");

    const cached = await cachedPrivateThumbnailUrl("/api/media/image-preview?id=abcdefghijklmnopqrst&size=thumb");

    expect(cached?.url).toBe("blob:cached-thumbnail");
    expect(URL.createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    cached?.revoke();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:cached-thumbnail");
  });

  it("does not leak cached thumbnails across signed-in users", async () => {
    await rememberPrivateThumbnail(
      "/api/media/image-preview?id=abcdefghijklmnopqrst&size=thumb",
      "/api/media/image-preview?id=abcdefghijklmnopqrst&size=thumb&token=signed",
    );

    mockGetMediaViewSessionContext.mockResolvedValue({
      accessToken: "session-token",
      userId: "user-b",
    });

    await expect(cachedPrivateThumbnailUrl("/api/media/image-preview?id=abcdefghijklmnopqrst&size=thumb"))
      .resolves.toBeNull();
  });
});
