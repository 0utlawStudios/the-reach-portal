import type { ContentCard, MediaAsset, RawFile } from "./types";
import { getPublicDriveDownloadUrl } from "./drive-url-utils";
import { driveFileIdFromUrl } from "./media-resolver";
import { isValidUuid } from "./utils";

export const MEDIA_MANUAL_USED_TAG = "__manual_used__";

type UrlParts = {
  url?: string;
  publishUrl?: string;
  driveProxyUrl?: string;
  playbackUrl?: string;
  fileId?: string;
};

function addDriveFileAliases(aliases: Set<string>, fileId: string | null | undefined) {
  if (!fileId) return;
  aliases.add(fileId);
  aliases.add(`/api/drive/stream?id=${encodeURIComponent(fileId)}`);
  aliases.add(getPublicDriveDownloadUrl(fileId));
}

function addUrlAlias(aliases: Set<string>, url: string | null | undefined) {
  if (!url || url.startsWith("blob:")) return;
  aliases.add(url);

  try {
    const parsed = new URL(url, "https://thereach.ten80ten.com");
    if (parsed.pathname === "/api/drive/stream") aliases.add(`${parsed.pathname}${parsed.search}`);
  } catch {
    // Keep the original string; malformed URLs just do not get derived aliases.
  }

  addDriveFileAliases(aliases, driveFileIdFromUrl(url));
}

export function mediaUrlAliases(parts: UrlParts): Set<string> {
  const aliases = new Set<string>();
  addUrlAlias(aliases, parts.url);
  addUrlAlias(aliases, parts.publishUrl);
  addUrlAlias(aliases, parts.driveProxyUrl);
  addUrlAlias(aliases, parts.playbackUrl);
  addDriveFileAliases(aliases, parts.fileId);
  return aliases;
}

function rawFileAliases(file: RawFile): Set<string> {
  return mediaUrlAliases({
    url: file.url,
    publishUrl: file.publishUrl,
    driveProxyUrl: file.driveProxyUrl,
    playbackUrl: file.playbackUrl,
    fileId: file.fileId,
  });
}

function cardMediaAliases(card: ContentCard): Set<string> {
  const aliases = new Set<string>();
  addUrlAlias(aliases, card.thumbnailUrl);
  addDriveFileAliases(aliases, card.sourceVault?.thumbnailFileId);
  card.assetUrls?.forEach((url) => addUrlAlias(aliases, url));
  card.mediaIds?.forEach((id) => addDriveFileAliases(aliases, id));
  card.sourceVault?.rawFiles?.forEach((file) => {
    rawFileAliases(file).forEach((alias) => aliases.add(alias));
  });
  return aliases;
}

export function mediaAssetAliases(asset: Pick<MediaAsset, "id" | "url">): Set<string> {
  const aliases = mediaUrlAliases({ url: asset.url });
  aliases.add(asset.id);
  return aliases;
}

export function cardUsesMediaAsset(card: ContentCard, asset: Pick<MediaAsset, "id" | "url">): boolean {
  if (card.mediaIds?.includes(asset.id)) return true;
  const assetAliases = mediaAssetAliases(asset);
  const cardAliases = cardMediaAliases(card);
  for (const alias of assetAliases) {
    if (cardAliases.has(alias)) return true;
  }
  return false;
}

export function getAutomaticMediaUsage(asset: Pick<MediaAsset, "id" | "url">, cards: readonly ContentCard[]): ContentCard[] {
  return cards.filter((card) => cardUsesMediaAsset(card, asset));
}

export function hasManualUsedTag(usedIn: readonly string[] | undefined): boolean {
  return !!usedIn?.includes(MEDIA_MANUAL_USED_TAG);
}

export function syncedUsedInValue(
  currentUsedIn: readonly string[] | undefined,
  automaticCards: readonly Pick<ContentCard, "id">[],
): string[] {
  const next = new Set<string>();
  if (hasManualUsedTag(currentUsedIn)) next.add(MEDIA_MANUAL_USED_TAG);
  automaticCards.forEach((card) => {
    if (isValidUuid(card.id)) next.add(card.id);
  });
  return Array.from(next).sort();
}

export function sameUsedIn(a: readonly string[] | undefined, b: readonly string[] | undefined): boolean {
  const left = [...(a || [])].sort();
  const right = [...(b || [])].sort();
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function videoPreviewFrameUrl(url: string): string {
  if (!url || url.includes("#t=")) return url;
  return `${url}#t=0.1`;
}
