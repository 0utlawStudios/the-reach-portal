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

  if (!displaySrc || failedSrc === displaySrc) {
    return (
      <div className={`${className || ""} flex items-center justify-center bg-[#6C655A]/15 text-[#6C655A]/55 dark:bg-white/[0.04] dark:text-gray-500`}>
        <ImageOff className="h-[45%] max-h-5 min-h-3 w-[45%] max-w-5 min-w-3" aria-hidden="true" />
      </div>
    );
  }

  return (
    <RawImage
      {...props}
      src={displaySrc}
      className={className}
      onError={(event: SyntheticEvent<HTMLImageElement, Event>) => {
        onError?.(event);
        setFailedSrc(typeof displaySrc === "string" ? displaySrc : undefined);
      }}
    />
  );
}
