import { getMediaViewSessionContext } from "@/lib/media-view-url";

const PRIVATE_THUMBNAIL_CACHE_NAME = "the-reach-private-thumbnails-v1";
const PRIVATE_THUMBNAIL_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_PRIVATE_THUMBNAIL_BYTES = 5 * 1024 * 1024;
const CACHE_KEY_PATH = "/__the-reach-private-thumbnail-cache";

export type CachedThumbnailUrl = {
  url: string;
  revoke: () => void;
};

function cacheApiAvailable(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof fetch === "function" &&
    typeof Response === "function" &&
    typeof Blob === "function" &&
    typeof URL !== "undefined" &&
    typeof URL.createObjectURL === "function" &&
    typeof URL.revokeObjectURL === "function" &&
    "caches" in globalThis &&
    Boolean(globalThis.caches)
  );
}

function currentOrigin(): string {
  if (typeof window !== "undefined" && window.location?.origin) return window.location.origin;
  return "https://thereach.ten80ten.com";
}

function stableThumbnailUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const parsed = new URL(value, currentOrigin());
    if (parsed.pathname !== "/api/media/image-preview") return null;
    const id = parsed.searchParams.get("id");
    if (!id || parsed.searchParams.get("size") !== "thumb") return null;
    return `/api/media/image-preview?${new URLSearchParams({ id, size: "thumb" }).toString()}`;
  } catch {
    return null;
  }
}

function cacheRequestUrl(stableUrl: string, userId: string): string {
  const params = new URLSearchParams({
    scope: userId,
    url: stableUrl,
  });
  return `${currentOrigin()}${CACHE_KEY_PATH}?${params.toString()}`;
}

async function cacheRequest(stableUrl: string): Promise<Request | null> {
  const session = await getMediaViewSessionContext();
  if (!session?.userId) return null;
  return new Request(cacheRequestUrl(stableUrl, session.userId), {
    method: "GET",
  });
}

function imageBlobIsSafe(blob: Blob): boolean {
  return blob.size > 0 &&
    blob.size <= MAX_PRIVATE_THUMBNAIL_BYTES &&
    blob.type.toLowerCase().startsWith("image/");
}

export function isCacheablePrivateThumbnailUrl(url: string | null | undefined): url is string {
  return Boolean(stableThumbnailUrl(url));
}

export async function cachedPrivateThumbnailUrl(url: string): Promise<CachedThumbnailUrl | null> {
  if (!cacheApiAvailable()) return null;
  const stableUrl = stableThumbnailUrl(url);
  if (!stableUrl) return null;

  try {
    const request = await cacheRequest(stableUrl);
    if (!request) return null;
    const cache = await caches.open(PRIVATE_THUMBNAIL_CACHE_NAME);
    const response = await cache.match(request);
    if (!response) return null;

    const cachedAt = Number(response.headers.get("x-the-reach-cached-at") || 0);
    if (!Number.isFinite(cachedAt) || Date.now() - cachedAt > PRIVATE_THUMBNAIL_CACHE_TTL_MS) {
      await cache.delete(request);
      return null;
    }

    const blob = await response.blob();
    if (!imageBlobIsSafe(blob)) {
      await cache.delete(request);
      return null;
    }

    const objectUrl = URL.createObjectURL(blob);
    return {
      url: objectUrl,
      revoke: () => URL.revokeObjectURL(objectUrl),
    };
  } catch {
    return null;
  }
}

export async function rememberPrivateThumbnail(stableSourceUrl: string, resolvedSourceUrl: string): Promise<void> {
  if (!cacheApiAvailable()) return;

  const stableUrl = stableThumbnailUrl(stableSourceUrl);
  const resolvedStableUrl = stableThumbnailUrl(resolvedSourceUrl);
  if (!stableUrl || resolvedStableUrl !== stableUrl) return;

  try {
    const request = await cacheRequest(stableUrl);
    if (!request) return;
    const response = await fetch(resolvedSourceUrl, {
      credentials: "same-origin",
      cache: "no-store",
    });
    if (!response.ok) return;

    const blob = await response.blob();
    if (!imageBlobIsSafe(blob)) return;

    const cache = await caches.open(PRIVATE_THUMBNAIL_CACHE_NAME);
    await cache.put(request, new Response(blob, {
      headers: {
        "Content-Type": blob.type || "image/jpeg",
        "Cache-Control": "private, max-age=604800",
        "X-The-Reach-Cached-At": String(Date.now()),
      },
    }));
  } catch {
    // The Cache API is a refresh optimization, not a source of truth.
  }
}

export async function clearPrivateThumbnailCache(): Promise<void> {
  if (!cacheApiAvailable()) return;
  try {
    await caches.delete(PRIVATE_THUMBNAIL_CACHE_NAME);
  } catch {
    // Best-effort test/support helper.
  }
}
