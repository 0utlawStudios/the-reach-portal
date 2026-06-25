import { supabase } from "./supabaseClient";

const PRIVATE_MEDIA_PATHS = new Set(["/api/drive/stream", "/api/media/image-preview"]);
const SIGNED_VIEW_URL_CACHE_MS = 12 * 60 * 1000;

type CachedViewUrl = {
  url: string;
  expiresAt: number;
};

const signedViewUrlCache = new Map<string, CachedViewUrl>();

export function isPrivateMediaRouteUrl(url: string | null | undefined): url is string {
  if (!url) return false;
  try {
    const parsed = new URL(url, "https://thereach.ten80ten.com");
    return PRIVATE_MEDIA_PATHS.has(parsed.pathname) && parsed.searchParams.has("id");
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

export async function signedMediaViewUrl(url: string): Promise<string | null> {
  if (!isPrivateMediaRouteUrl(url) || hasMediaViewToken(url)) return null;

  const cached = signedViewUrlCache.get(url);
  if (cached && cached.expiresAt > Date.now()) return cached.url;

  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return null;

  const response = await fetch(`/api/media/view-url?${new URLSearchParams({ url }).toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) return null;
  const body = await response.json().catch(() => null) as { url?: unknown } | null;
  if (typeof body?.url !== "string" || !isPrivateMediaRouteUrl(body.url) || !hasMediaViewToken(body.url)) return null;

  signedViewUrlCache.set(url, { url: body.url, expiresAt: Date.now() + SIGNED_VIEW_URL_CACHE_MS });
  return body.url;
}
