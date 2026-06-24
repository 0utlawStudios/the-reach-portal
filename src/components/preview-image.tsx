"use client";

import type { ImgHTMLAttributes, SyntheticEvent } from "react";
import { useMemo, useState } from "react";
import { ImageOff } from "lucide-react";
import { RawImage } from "@/components/raw-image";
import { browserImagePreviewUrl } from "@/lib/image-preview";

type PreviewImageProps = ImgHTMLAttributes<HTMLImageElement> & {
  mimeType?: unknown;
  fileName?: unknown;
};

export function PreviewImage({
  src,
  mimeType,
  fileName,
  className,
  onError,
  ...props
}: PreviewImageProps) {
  const displaySrc = useMemo(() => {
    return typeof src === "string" ? browserImagePreviewUrl(src, { mimeType, fileName }) : src;
  }, [src, mimeType, fileName]);
  const [failedSrc, setFailedSrc] = useState<string | undefined>(undefined);
  const [loadedSrc, setLoadedSrc] = useState<string | undefined>(undefined);

  if (!displaySrc || failedSrc === displaySrc) {
    return (
      <div className={`${className || ""} flex items-center justify-center bg-[#6C655A]/15 text-[#6C655A]/55 dark:bg-white/[0.04] dark:text-gray-500`}>
        <ImageOff className="h-[45%] max-h-5 min-h-3 w-[45%] max-w-5 min-w-3" aria-hidden="true" />
      </div>
    );
  }

  const fitClass =
    typeof className === "string" && className.includes("object-contain")
      ? "object-contain"
      : "object-cover";
  const isLoaded = typeof displaySrc !== "string" || loadedSrc === displaySrc;

  return (
    <div className={`${className || ""} relative overflow-hidden bg-[#6C655A]/10 dark:bg-white/[0.03]`}>
      {!isLoaded && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#111113]/70 text-white/70" aria-hidden="true">
          <div className="h-7 w-7 rounded-full border-2 border-white/30 border-t-white/80 animate-spin" />
        </div>
      )}
      <RawImage
        {...props}
        src={displaySrc}
        className={`absolute inset-0 h-full w-full ${fitClass} transition-opacity duration-150 ${isLoaded ? "opacity-100" : "opacity-0"}`}
        onLoad={() => setLoadedSrc(typeof displaySrc === "string" ? displaySrc : undefined)}
        onError={(event: SyntheticEvent<HTMLImageElement, Event>) => {
          onError?.(event);
          setFailedSrc(typeof displaySrc === "string" ? displaySrc : undefined);
        }}
      />
    </div>
  );
}
