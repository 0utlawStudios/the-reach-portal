import { normalizeDriveMimeType } from "@/lib/drive-policy";
import { driveFileIdFromUrl } from "@/lib/media-resolver";

const HEIC_IMAGE_MIME_TYPES = new Set(["image/heic", "image/heic-sequence", "image/heif", "image/heif-sequence"]);
const THUMBNAIL_IMAGE_MIME_TYPES = new Set([
  "image/avif",
  "image/bmp",
  "image/gif",
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/tiff",
  "image/webp",
]);
const HEIC_EXT_RE = /\.(hei[cf])(?:[?#].*)?$/i;
const HEIC_PREVIEW_WARM_TIMEOUT_MS = 55_000;
export type BrowserImagePreviewSize = "thumb" | "full";

export function isHeicLikeImage(mimeType?: unknown, fileNameOrUrl?: unknown): boolean {
  const normalized = normalizeDriveMimeType(mimeType, fileNameOrUrl);
  if (HEIC_IMAGE_MIME_TYPES.has(normalized)) return true;
  return typeof fileNameOrUrl === "string" && HEIC_EXT_RE.test(fileNameOrUrl);
}

export function heicImagePreviewUrl(
  url: string,
  opts: { mimeType?: unknown; fileName?: unknown; size?: BrowserImagePreviewSize } = {},
): string | null {
  if (!url || !isHeicLikeImage(opts.mimeType, opts.fileName || url)) return null;

  const fileId = driveFileIdFromUrl(url);
  if (!fileId) return null;

  const params = new URLSearchParams({ id: fileId });
  if (opts.size) params.set("size", opts.size);
  return `/api/media/image-preview?${params.toString()}`;
}

export function imageThumbnailPreviewUrl(
  url: string,
  opts: { mimeType?: unknown; fileName?: unknown } = {},
): string | null {
  if (!url) return null;
  const normalized = normalizeDriveMimeType(opts.mimeType, opts.fileName || url);
  // Videos get a cached poster from Drive's generated thumbnailLink (server side), so the
  // grid shows a still frame like an image instead of mounting a live <video> per cell.
  const isSupportedThumbnail =
    HEIC_IMAGE_MIME_TYPES.has(normalized) ||
    THUMBNAIL_IMAGE_MIME_TYPES.has(normalized) ||
    normalized.startsWith("video/");
  if (!isSupportedThumbnail) return null;

  const fileId = driveFileIdFromUrl(url);
  if (!fileId) return null;

  return `/api/media/image-preview?${new URLSearchParams({ id: fileId, size: "thumb" }).toString()}`;
}

export function browserImagePreviewUrl(
  url: string,
  opts: { mimeType?: unknown; fileName?: unknown; size?: BrowserImagePreviewSize } = {},
): string {
  if (opts.size === "thumb") return imageThumbnailPreviewUrl(url, opts) || url;
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
  const previewUrl = opts.size === "thumb"
    ? imageThumbnailPreviewUrl(url, opts)
    : heicImagePreviewUrl(url, opts);
  if (!previewUrl || typeof fetch !== "function") return;

  if (opts.size) {
    void warmPreviewUrl(previewUrl);
    return;
  }

  const thumbUrl = imageThumbnailPreviewUrl(url, opts);
  void (async () => {
    if (thumbUrl) await warmPreviewUrl(thumbUrl);
    await warmPreviewUrl(previewUrl);
  })();
}
