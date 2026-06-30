import type { ContentCard, ContentType, RawFile } from "./types";
import { isValidUuid } from "./utils";

const IMAGE_EXT_RE = /\.(avif|gif|jpe?g|png|webp)(?:[?#].*)?$/i;
const DRIVE_FILE_ID_RE = /^[a-zA-Z0-9_-]{20,80}$/;

export function isVideoContentType(contentType: ContentType): boolean {
  return contentType === "video" || contentType === "reel" || contentType === "story";
}

export function driveFileIdFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const queryMatch = url.match(/[?&]id=([^&]+)/);
  if (queryMatch?.[1]) return decodeURIComponent(queryMatch[1]);
  const playbackKeyMatch = url.match(/[?&]key=([^&]+)/);
  const playbackKeyFileId = legacyPlaybackDriveFileId(playbackKeyMatch?.[1]);
  if (playbackKeyFileId) return playbackKeyFileId;
  const filePathMatch = url.match(/\/file\/d\/([^/]+)/);
  if (filePathMatch?.[1]) return decodeURIComponent(filePathMatch[1]);
  return legacyPlaybackDriveFileId(url);
}

function legacyPlaybackDriveFileId(value: string | null | undefined): string | null {
  if (!value) return null;
  const decoded = decodeURIComponent(value);
  if (!decoded.includes("media-playback") && !decoded.includes("/posts/")) return null;
  const fileName = decoded.split(/[?#]/)[0]?.split("/").pop() || "";
  const match = fileName.match(/^([a-zA-Z0-9_]{20,80})-/);
  return match?.[1] || null;
}

function isLikelyDriveFileId(value: string | null | undefined): value is string {
  return Boolean(value && DRIVE_FILE_ID_RE.test(value) && !isValidUuid(value));
}

export function firstVideoRawFile(card: Pick<ContentCard, "sourceVault">): RawFile | null {
  return card.sourceVault?.rawFiles?.find((file) => file.mimeType?.startsWith("video/")) || null;
}

function matchingThumbnailRawFile(card: Pick<ContentCard, "thumbnailUrl" | "sourceVault">): RawFile | null {
  const files = card.sourceVault?.rawFiles || [];
  if (files.length === 0) return null;

  const thumbFileId = driveFileIdFromUrl(card.thumbnailUrl);
  return files.find((file) => {
    return Boolean(
      (thumbFileId && file.fileId === thumbFileId)
        || file.driveProxyUrl === card.thumbnailUrl
        || file.publishUrl === card.thumbnailUrl
        || file.url === card.thumbnailUrl,
    );
  }) || files.find((file) => file.usageType === "master") || null;
}

export function resolveCardThumbnailMimeType(card: Pick<ContentCard, "thumbnailUrl" | "sourceVault">): string | undefined {
  return card.sourceVault?.thumbnailMimeType || matchingThumbnailRawFile(card)?.mimeType;
}

export function resolveCardThumbnailFileName(card: Pick<ContentCard, "thumbnailUrl" | "sourceVault">): string | undefined {
  return matchingThumbnailRawFile(card)?.name;
}

export function resolveCardVideoUrl(card: Pick<ContentCard, "contentType" | "thumbnailUrl" | "mediaIds" | "sourceVault">): string | null {
  if (!isVideoContentType(card.contentType)) return null;

  const rawVideo = firstVideoRawFile(card);
  if (rawVideo?.playbackUrl) return rawVideo.playbackUrl;
  if (rawVideo?.driveProxyUrl) return rawVideo.driveProxyUrl;
  if (rawVideo?.url) return rawVideo.url;

  const thumbFileId = driveFileIdFromUrl(card.thumbnailUrl);
  const videoId = card.mediaIds?.find((id) => id !== thumbFileId && isLikelyDriveFileId(id));
  if (videoId) return `/api/drive/stream?id=${encodeURIComponent(videoId)}`;

  return card.thumbnailUrl || null;
}

export function thumbnailIsDefinitelyImage(card: Pick<ContentCard, "thumbnailUrl" | "sourceVault">): boolean {
  const mimeType = resolveCardThumbnailMimeType(card);
  if (mimeType?.startsWith("image/")) return true;
  if (card.thumbnailUrl.startsWith("data:image/")) return true;
  if (card.thumbnailUrl.startsWith("blob:")) return true;
  return IMAGE_EXT_RE.test(card.thumbnailUrl);
}
