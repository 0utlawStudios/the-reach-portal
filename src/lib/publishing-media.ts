import type { ContentCard } from "@/lib/types";

type PublishingMediaCard = Pick<ContentCard, "sourceVault" | "assetUrls">;

export function hasPublishingMedia(card: PublishingMediaCard | null | undefined): boolean {
  if (!card) return false;
  const rawFiles = card.sourceVault?.rawFiles;
  if (Array.isArray(rawFiles) && rawFiles.length > 0) return true;
  const assetUrls = card.assetUrls;
  return Array.isArray(assetUrls) && assetUrls.some((url) => typeof url === "string" && url.trim().length > 0);
}
