import { normalizeDriveMimeType } from "@/lib/drive-policy";
import { driveFileIdFromUrl } from "@/lib/media-resolver";

const HEIC_IMAGE_MIME_TYPES = new Set(["image/heic", "image/heic-sequence", "image/heif", "image/heif-sequence"]);
const HEIC_EXT_RE = /\.(hei[cf])(?:[?#].*)?$/i;
const HEIC_PREVIEW_WARM_TIMEOUT_MS = 55_000;
export type BrowserImagePreviewSize = "thumb" | "full";

export function isHeicLikeImage(mimeType?: unknown, fileNameOrUrl?: unknown): boolean {
  const normalized = normalizeDriveMimeType(mimeType, fileNameOrUrl);
  if (HEIC_IMAGE_MIME_TYPES.has(normalized)) return true;
  return typeof fileNameOrUrl === "string" && HEIC_EXT_RE.test(fileNameOrUrl);
}

function driveStreamTokenFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url, "http://local.invalid");
    return parsed.searchParams.get("token");
  } catch {
    const match = url.match(/[?&]token=([^&]+)/);
    return match?.[1] ? decodeURIComponent(match[1]) : null;
  }
}

export function heicImagePreviewUrl(
  url: string,
  opts: { mimeType?: unknown; fileName?: unknown; size?: BrowserImagePreviewSize } = {},
): string | null {
  if (!url || !isHeicLikeImage(opts.mimeType, opts.fileName || url)) return null;

  const fileId = driveFileIdFromUrl(url);
  if (!fileId) return null;

  const params = new URLSearchParams({ id: fileId });
  const token = driveStreamTokenFromUrl(url);
  if (token) params.set("token", token);
  if (opts.size) params.set("size", opts.size);
  return `/api/media/image-preview?${params.toString()}`;
}

export function browserImagePreviewUrl(
  url: string,
  opts: { mimeType?: unknown; fileName?: unknown; size?: BrowserImagePreviewSize } = {},
): string {
  return heicImagePreviewUrl(url, opts) || url;
}

async function warmPreviewUrl(previewUrl: string): Promise<void> {
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timer = controller
    ? setTimeout(() => controller.abort(), HEIC_PREVIEW_WARM_TIMEOUT_MS)
    : undefined;

  try {
    await fetch(previewUrl, {
      method: "GET",
      credentials: "same-origin",
      cache: "force-cache",
      signal: controller?.signal,
    });
  } catch {
    // Cache warming is best-effort. The visible <img> path still handles errors.
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function warmBrowserImagePreview(
  url: string,
  opts: { mimeType?: unknown; fileName?: unknown; size?: BrowserImagePreviewSize } = {},
): void {
  const previewUrl = heicImagePreviewUrl(url, opts);
  if (!previewUrl || typeof fetch !== "function") return;

  if (opts.size) {
    void warmPreviewUrl(previewUrl);
    return;
  }

  const thumbUrl = heicImagePreviewUrl(url, { ...opts, size: "thumb" });
  void (async () => {
    if (thumbUrl) await warmPreviewUrl(thumbUrl);
    await warmPreviewUrl(previewUrl);
  })();
}
