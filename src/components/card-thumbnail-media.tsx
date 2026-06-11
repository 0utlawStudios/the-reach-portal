"use client";

import { useMemo, useState } from "react";
import { ImageOff } from "lucide-react";
import { RawImage } from "@/components/raw-image";
import type { ContentCard } from "@/lib/types";
import { isVideoContentType, resolveCardVideoUrl, thumbnailIsDefinitelyImage } from "@/lib/media-resolver";

type CardThumbnailMediaProps = {
  card: Pick<ContentCard, "title" | "contentType" | "thumbnailUrl" | "mediaIds" | "sourceVault">;
  className: string;
  fallbackLabel?: string;
  draggable?: boolean;
};

export function CardThumbnailMedia({
  card,
  className,
  fallbackLabel = "No media",
  draggable = false,
}: CardThumbnailMediaProps) {
  const videoUrl = useMemo(() => resolveCardVideoUrl(card), [card]);
  const mediaKey = `${card.thumbnailUrl || ""}|${videoUrl || ""}`;
  const [failedMediaKey, setFailedMediaKey] = useState<string | null>(null);
  const isVideoCard = isVideoContentType(card.contentType);
  const hasReliableImageThumbnail = card.thumbnailUrl && (!isVideoCard || thumbnailIsDefinitelyImage(card));
  const imageFailed = failedMediaKey === mediaKey;
  const shouldRenderVideo = isVideoCard && videoUrl && (!hasReliableImageThumbnail || imageFailed);

  if (shouldRenderVideo) {
    return (
      <video
        key={videoUrl}
        src={videoUrl}
        muted
        playsInline
        preload="metadata"
        className={className}
        aria-label={`${card.title} video preview`}
      />
    );
  }

  if (card.thumbnailUrl && !imageFailed) {
    return (
      <RawImage
        src={card.thumbnailUrl}
        alt={card.title}
        className={className}
        draggable={draggable}
        onError={() => setFailedMediaKey(mediaKey)}
      />
    );
  }

  return (
    <div className={`${className} flex items-center justify-center bg-[#6C655A]/15 text-[#6C655A]/55 dark:bg-white/[0.04] dark:text-gray-500`}>
      <ImageOff className="h-[45%] max-h-5 min-h-3 w-[45%] max-w-5 min-w-3" aria-hidden="true" />
      <span className="sr-only">{fallbackLabel}</span>
    </div>
  );
}
