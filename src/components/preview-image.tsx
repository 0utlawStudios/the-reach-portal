"use client";

import type { ImgHTMLAttributes, SyntheticEvent } from "react";
import { useEffect, useMemo, useState } from "react";
import { ImageOff } from "lucide-react";
import { RawImage } from "@/components/raw-image";
import { browserImagePreviewUrl } from "@/lib/image-preview";

type PreviewImageProps = ImgHTMLAttributes<HTMLImageElement> & {
  mimeType?: unknown;
  fileName?: unknown;
};

const IMAGE_PREVIEW_LOAD_TIMEOUT_MS = 60_000;
const FALLBACK_PREVIEW_LOAD_TIMEOUT_MS = 2_500;

export function PreviewImage({
  src,
  mimeType,
  fileName,
  className,
  loading,
  onLoad,
  onError,
  ...props
}: PreviewImageProps) {
  const wantsFullPreview = typeof className === "string" && className.includes("object-contain");
  const { primarySrc, fallbackSrc } = useMemo(() => {
    if (typeof src !== "string") return { primarySrc: src, fallbackSrc: undefined };
    const thumb = browserImagePreviewUrl(src, { mimeType, fileName, size: "thumb" });
    const full = wantsFullPreview
      ? browserImagePreviewUrl(src, { mimeType, fileName, size: "full" })
      : thumb;
    return {
      primarySrc: full,
      fallbackSrc: wantsFullPreview && thumb !== full ? thumb : undefined,
    };
  }, [src, mimeType, fileName, wantsFullPreview]);
  const [failedSrcs, setFailedSrcs] = useState<Record<string, true>>({});
  const [loadedSrc, setLoadedSrc] = useState<string | undefined>(undefined);
  const [loadedFallbackSrc, setLoadedFallbackSrc] = useState<string | undefined>(undefined);

  const fitClass =
    typeof className === "string" && className.includes("object-contain")
      ? "object-contain"
      : "object-cover";
  const primaryFailed = typeof primarySrc === "string" && Boolean(failedSrcs[primarySrc]);
  const fallbackFailed = typeof fallbackSrc === "string" && Boolean(failedSrcs[fallbackSrc]);
  const isLoaded = typeof primarySrc !== "string" || loadedSrc === primarySrc;
  const fallbackLoaded = typeof fallbackSrc === "string" && loadedFallbackSrc === fallbackSrc;
  const canShowFallback = Boolean(fallbackSrc && fallbackLoaded && !fallbackFailed);
  const shouldLoadPrimary = !fallbackSrc || wantsFullPreview || fallbackLoaded || fallbackFailed;
  const missingOrFailed = !primarySrc || (primaryFailed && !canShowFallback);
  const showSpinner = !isLoaded && !canShowFallback;
  const effectiveLoading = loading || (wantsFullPreview ? "eager" : undefined);

  useEffect(() => {
    if (typeof fallbackSrc !== "string" || fallbackLoaded || fallbackFailed) return;
    const timer = setTimeout(() => {
      setFailedSrcs((prev) => ({ ...prev, [fallbackSrc]: true }));
    }, FALLBACK_PREVIEW_LOAD_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [fallbackSrc, fallbackLoaded, fallbackFailed]);

  useEffect(() => {
    if (missingOrFailed || typeof primarySrc !== "string" || isLoaded || canShowFallback || !shouldLoadPrimary) return;
    const timer = setTimeout(() => {
      setFailedSrcs((prev) => ({ ...prev, [primarySrc]: true }));
      onError?.({} as SyntheticEvent<HTMLImageElement, Event>);
    }, IMAGE_PREVIEW_LOAD_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [primarySrc, isLoaded, missingOrFailed, canShowFallback, shouldLoadPrimary, onError]);

  if (missingOrFailed) {
    return (
      <div className={`${className || ""} flex items-center justify-center bg-[#6C655A]/15 text-[#6C655A]/55 dark:bg-white/[0.04] dark:text-gray-500`}>
        <ImageOff className="h-[45%] max-h-5 min-h-3 w-[45%] max-w-5 min-w-3" aria-hidden="true" />
      </div>
    );
  }

  return (
    <div className={`${className || ""} relative overflow-hidden bg-[#6C655A]/10 dark:bg-white/[0.03]`}>
      {showSpinner && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-100/95 text-[#975428] dark:bg-[#151518]/95 dark:text-white/75" aria-hidden="true">
          <div className="h-7 w-7 rounded-full border-2 border-current/25 border-t-current animate-spin" />
        </div>
      )}
      {typeof fallbackSrc === "string" && (
        <RawImage
          {...props}
          alt=""
          aria-hidden="true"
          src={fallbackSrc}
          loading={effectiveLoading}
          className={`absolute inset-0 h-full w-full ${fitClass} transition-opacity duration-150 ${canShowFallback && !isLoaded ? "opacity-100" : "opacity-0"}`}
          onLoad={() => {
            setLoadedFallbackSrc(fallbackSrc);
          }}
          onError={(event: SyntheticEvent<HTMLImageElement, Event>) => {
            onError?.(event);
            setFailedSrcs((prev) => ({ ...prev, [fallbackSrc]: true }));
          }}
        />
      )}
      {shouldLoadPrimary && (
        <RawImage
          {...props}
          src={primarySrc}
          loading={effectiveLoading}
          className={`absolute inset-0 h-full w-full ${fitClass} transition-opacity duration-150 ${isLoaded ? "opacity-100" : "opacity-0"}`}
          onLoad={(event: SyntheticEvent<HTMLImageElement, Event>) => {
            setLoadedSrc(typeof primarySrc === "string" ? primarySrc : undefined);
            onLoad?.(event);
          }}
          onError={(event: SyntheticEvent<HTMLImageElement, Event>) => {
            onError?.(event);
            if (typeof primarySrc === "string") {
              setFailedSrcs((prev) => ({ ...prev, [primarySrc]: true }));
            }
          }}
        />
      )}
    </div>
  );
}
