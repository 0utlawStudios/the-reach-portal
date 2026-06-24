import { normalizeDriveMimeType } from "@/lib/drive-policy";
import { driveFileIdFromUrl } from "@/lib/media-resolver";

const HEIC_IMAGE_MIME_TYPES = new Set(["image/heic", "image/heif"]);
const HEIC_EXT_RE = /\.(hei[cf])(?:[?#].*)?$/i;

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

export function browserImagePreviewUrl(
  url: string,
  opts: { mimeType?: unknown; fileName?: unknown } = {},
): string {
  if (!url || !isHeicLikeImage(opts.mimeType, opts.fileName || url)) return url;

  const fileId = driveFileIdFromUrl(url);
  if (!fileId) return url;

  const params = new URLSearchParams({ id: fileId });
  const token = driveStreamTokenFromUrl(url);
  if (token) params.set("token", token);
  return `/api/media/image-preview?${params.toString()}`;
}
