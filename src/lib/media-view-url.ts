import { supabase } from "./supabaseClient";

const PRIVATE_MEDIA_PATHS = new Set(["/api/drive/stream", "/api/media/image-preview", "/api/media/playback"]);
const SIGNED_VIEW_URL_CACHE_MS = 12 * 60 * 1000;
const SIGNED_VIEW_URL_TIMEOUT_MS = 8_000;
const SIGNED_VIEW_SESSION_TIMEOUT_MS = 3_000;

type CachedViewUrl = {
  url: string;
  expiresAt: number;
};

export type MediaViewSessionContext = {
  accessToken: string;
  userId?: string;
};

const signedViewUrlCache = new Map<string, CachedViewUrl>();

export function clearSignedMediaViewUrlCache(): void {
  signedViewUrlCache.clear();
}

export function isPrivateMediaRouteUrl(url: string | null | undefined): url is string {
  if (!url) return false;
  try {
    const parsed = new URL(url, "https://thereach.ten80ten.com");
    if (!PRIVATE_MEDIA_PATHS.has(parsed.pathname)) return false;
    return parsed.pathname === "/api/media/playback"
      ? parsed.searchParams.has("key")
      : parsed.searchParams.has("id");
  } catch {
    return false;
  }
}

export function hasMediaViewToken(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    return new URL(url, "https://thereach.ten80ten.com").searchParams.has("token");
  } catch {
    return /[?&]token=/i.test(url);
  }
}

export async function getMediaViewSessionContext(): Promise<MediaViewSessionContext | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      supabase.auth.getSession(),
      new Promise<"timeout">((resolve) => {
        timer = setTimeout(() => resolve("timeout"), SIGNED_VIEW_SESSION_TIMEOUT_MS);
      }),
    ]);
    if (result === "timeout") return null;
    const accessToken = result.data.session?.access_token;
    if (!accessToken) return null;
    return {
      accessToken,
      userId: result.data.session?.user?.id,
    };
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

type PendingSign = { url: string; resolve: (value: string | null) => void };

const SIGN_BATCH_MAX = 100;
let pendingSigns: PendingSign[] = [];
let signFlushScheduled = false;

function scheduleSignFlush(): void {
  if (signFlushScheduled) return;
  signFlushScheduled = true;
  setTimeout(() => { void flushSignQueue(); }, 0);
}

async function flushSignQueue(): Promise<void> {
  signFlushScheduled = false;
  const batch = pendingSigns;
  pendingSigns = [];
  if (batch.length === 0) return;

  const session = await getMediaViewSessionContext();
  const token = session?.accessToken;
  if (!token) {
    batch.forEach((pending) => pending.resolve(null));
    return;
  }

  // Serve cache hits immediately; group the misses so each distinct URL is signed once.
  const waitersByUrl = new Map<string, PendingSign[]>();
  for (const pending of batch) {
    const cached = signedViewUrlCache.get(`${pending.url}\n${token}`);
    if (cached && cached.expiresAt > Date.now()) {
      pending.resolve(cached.url);
      continue;
    }
    const group = waitersByUrl.get(pending.url);
    if (group) group.push(pending);
    else waitersByUrl.set(pending.url, [pending]);
  }

  const urls = [...waitersByUrl.keys()];
  for (let index = 0; index < urls.length; index += SIGN_BATCH_MAX) {
    void signChunk(urls.slice(index, index + SIGN_BATCH_MAX), token, waitersByUrl);
  }
}

async function signChunk(urls: string[], token: string, waitersByUrl: Map<string, PendingSign[]>): Promise<void> {
  const settle = (url: string, signed: string | null) => {
    if (signed) {
      signedViewUrlCache.set(`${url}\n${token}`, { url: signed, expiresAt: Date.now() + SIGNED_VIEW_URL_CACHE_MS });
    }
    waitersByUrl.get(url)?.forEach((pending) => pending.resolve(signed));
  };

  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), SIGNED_VIEW_URL_TIMEOUT_MS) : undefined;
  let response: Response;
  try {
    response = await fetch("/api/media/view-url/batch", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ urls }),
      signal: controller?.signal,
    });
  } catch {
    urls.forEach((url) => settle(url, null));
    return;
  } finally {
    if (timer) clearTimeout(timer);
  }

  if (!response.ok) {
    urls.forEach((url) => settle(url, null));
    return;
  }

  const body = await response.json().catch(() => null) as { results?: Array<{ input?: unknown; url?: unknown }> } | null;
  const signedByInput = new Map<string, string>();
  if (body && Array.isArray(body.results)) {
    for (const entry of body.results) {
      if (
        typeof entry?.input === "string" &&
        typeof entry?.url === "string" &&
        isPrivateMediaRouteUrl(entry.url) &&
        hasMediaViewToken(entry.url)
      ) {
        signedByInput.set(entry.input, entry.url);
      }
    }
  }
  urls.forEach((url) => settle(url, signedByInput.get(url) ?? null));
}

// Signs a private media URL by coalescing concurrent requests (e.g. a whole grid mounting at
// once) into batched POSTs, so a fresh-device library load makes a handful of calls, not one
// per cell. The returned URL carries a short-lived token; see /api/media/view-url/batch.
export async function signedMediaViewUrl(url: string): Promise<string | null> {
  if (!isPrivateMediaRouteUrl(url) || hasMediaViewToken(url)) return null;
  return new Promise<string | null>((resolve) => {
    pendingSigns.push({ url, resolve });
    scheduleSignFlush();
  });
}

export async function resolveViewableMediaUrl(url: string): Promise<string> {
  if (!isPrivateMediaRouteUrl(url) || hasMediaViewToken(url)) return url;
  const signedUrl = await signedMediaViewUrl(url);
  if (!signedUrl) throw new Error("Could not create a short-lived media link");
  return signedUrl;
}
