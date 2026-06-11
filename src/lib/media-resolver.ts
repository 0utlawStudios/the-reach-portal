import type { ContentCard, ContentType, RawFile } from "./types";

const IMAGE_EXT_RE = /\.(avif|gif|jpe?g|png|webp)(?:[?#].*)?$/i;

export function isVideoContentType(contentType: ContentType): boolean {
  return contentType === "video" || contentType === "reel" || contentType === "story";
}

export function driveFileIdFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const match = url.match(/[?&]id=([^&]+)/);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

export function firstVideoRawFile(card: Pick<ContentCard, "sourceVault">): RawFile | null {
  return card.sourceVault?.rawFiles?.find((file) => file.mimeType?.startsWith("video/")) || null;
}

export function resolveCardVideoUrl(card: Pick<ContentCard, "contentType" | "thumbnailUrl" | "mediaIds" | "sourceVault">): string | null {
  if (!isVideoContentType(card.contentType)) return null;

  const rawVideo = firstVideoRawFile(card);
  if (rawVideo?.playbackUrl) return rawVideo.playbackUrl;
  if (rawVideo?.driveProxyUrl) return rawVideo.driveProxyUrl;
  if (rawVideo?.url) return rawVideo.url;

  const thumbFileId = driveFileIdFromUrl(card.thumbnailUrl);
  const videoId = card.mediaIds?.find((id) => id !== thumbFileId);
  if (videoId) return `/api/drive/stream?id=${encodeURIComponent(videoId)}`;

  return card.thumbnailUrl || null;
}

export function thumbnailIsDefinitelyImage(card: Pick<ContentCard, "thumbnailUrl" | "sourceVault">): boolean {
  const mimeType = card.sourceVault?.thumbnailMimeType;
  if (mimeType?.startsWith("image/")) return true;
  if (card.thumbnailUrl.startsWith("data:image/")) return true;
  if (card.thumbnailUrl.startsWith("blob:")) return true;
  return IMAGE_EXT_RE.test(card.thumbnailUrl);
}
