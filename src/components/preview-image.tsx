"use client";

import type { ImgHTMLAttributes, SyntheticEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ImageOff } from "lucide-react";
import { RawImage } from "@/components/raw-image";
import { browserImagePreviewUrl, isHeicLikeImage } from "@/lib/image-preview";
import { isPrivateMediaRouteUrl, signedMediaViewUrl } from "@/lib/media-view-url";
import {
  cachedPrivateThumbnailUrl,
  isCacheablePrivateThumbnailUrl,
  rememberPrivateThumbnail,
} from "@/lib/private-thumbnail-cache";

type PreviewImageProps = ImgHTMLAttributes<HTMLImageElement> & {
  mimeType?: unknown;
  fileName?: unknown;
};

const IMAGE_PREVIEW_LOAD_TIMEOUT_MS = 60_000;
const FALLBACK_PREVIEW_LOAD_TIMEOUT_MS = 4_000;
const FULL_PREVIEW_LOAD_DELAY_MS = 1_200;

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
  const [timedOutFallbackSrcs, setTimedOutFallbackSrcs] = useState<Record<string, true>>({});
  const [delayedPrimarySrcs, setDelayedPrimarySrcs] = useState<Record<string, true>>({});
  const [signedSrcs, setSignedSrcs] = useState<Record<string, string>>({});
  const [signingSrcs, setSigningSrcs] = useState<Record<string, true>>({});
  const [cachedThumbnailSrcs, setCachedThumbnailSrcs] = useState<Record<string, string>>({});
  const cachedThumbnailRevokersRef = useRef<Record<string, () => void>>({});
  const [loadedSrc, setLoadedSrc] = useState<string | undefined>(undefined);
  const [loadedFallbackSrc, setLoadedFallbackSrc] = useState<string | undefined>(undefined);
  const proactiveSignAttemptsRef = useRef<Set<string>>(new Set());
  const failAfterSigningRef = useRef<Set<string>>(new Set());

  const fitClass =
    typeof className === "string" && className.includes("object-contain")
      ? "object-contain"
      : "object-cover";
  const primaryFailed = typeof primarySrc === "string" && Boolean(failedSrcs[primarySrc]);
  const fallbackFailed = typeof fallbackSrc === "string" && Boolean(failedSrcs[fallbackSrc]);
  const fallbackTimedOut = typeof fallbackSrc === "string" && Boolean(timedOutFallbackSrcs[fallbackSrc]);
  const isLoaded = typeof primarySrc !== "string" || loadedSrc === primarySrc;
  const fallbackLoaded = typeof fallbackSrc === "string" && loadedFallbackSrc === fallbackSrc;
  const primaryDelayKey =
    typeof fallbackSrc === "string" && typeof primarySrc === "string"
      ? `${fallbackSrc}\n${primarySrc}`
      : undefined;
  const primaryDelayElapsed = Boolean(primaryDelayKey && delayedPrimarySrcs[primaryDelayKey]);
  const canShowFallback = Boolean(fallbackSrc && fallbackLoaded && !fallbackFailed);
  const shouldLoadPrimary = !fallbackSrc || fallbackLoaded || fallbackFailed || fallbackTimedOut || primaryDelayElapsed;
  const missingOrFailed = !primarySrc || (primaryFailed && !canShowFallback);
  const showSpinner = !isLoaded && !canShowFallback;
  const effectiveLoading = loading || (wantsFullPreview ? "eager" : undefined);
  const localHeicUnsupported =
    typeof primarySrc === "string" &&
    primarySrc.startsWith("blob:") &&
    isHeicLikeImage(mimeType, fileName || primarySrc);
  const renderedPrimarySrc = typeof primarySrc === "string"
    ? cachedThumbnailSrcs[primarySrc] || signedSrcs[primarySrc] || primarySrc
    : primarySrc;
  const renderedFallbackSrc = typeof fallbackSrc === "string"
    ? cachedThumbnailSrcs[fallbackSrc] || signedSrcs[fallbackSrc] || fallbackSrc
    : fallbackSrc;

  const requestSignedSrc = useCallback((source: string, failOnMiss: boolean): boolean => {
    if (!isPrivateMediaRouteUrl(source)) return false;
    if (signingSrcs[source]) {
      if (failOnMiss) failAfterSigningRef.current.add(source);
      return true;
    }
    if (signedSrcs[source]) return !failOnMiss;
    setSigningSrcs((prev) => ({ ...prev, [source]: true }));
    void signedMediaViewUrl(source)
      .then((signedUrl) => {
        const shouldFailOnMiss = failOnMiss || failAfterSigningRef.current.has(source);
        if (!signedUrl) {
          if (shouldFailOnMiss) setFailedSrcs((prev) => ({ ...prev, [source]: true }));
          return;
        }
        setSignedSrcs((prev) => ({ ...prev, [source]: signedUrl }));
        if (isCacheablePrivateThumbnailUrl(source)) {
          void rememberPrivateThumbnail(source, signedUrl);
        }
        setFailedSrcs((prev) => {
          if (!prev[source]) return prev;
          const next = { ...prev };
          delete next[source];
          return next;
        });
      })
      .catch(() => {
        if (failOnMiss || failAfterSigningRef.current.has(source)) setFailedSrcs((prev) => ({ ...prev, [source]: true }));
      })
      .finally(() => {
        failAfterSigningRef.current.delete(source);
        setSigningSrcs((prev) => {
          const next = { ...prev };
          delete next[source];
          return next;
        });
      });
    return true;
  }, [signedSrcs, signingSrcs]);

  const signAndRetry = useCallback((source: string): boolean => {
    return requestSignedSrc(source, true);
  }, [requestSignedSrc]);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      for (const source of [fallbackSrc, primarySrc]) {
        if (typeof source !== "string" || proactiveSignAttemptsRef.current.has(source)) continue;
        proactiveSignAttemptsRef.current.add(source);
        requestSignedSrc(source, false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [fallbackSrc, primarySrc, requestSignedSrc]);

  useEffect(() => {
    const activeSources = new Set(
      [fallbackSrc, primarySrc].filter((source): source is string => (
        typeof source === "string" && isCacheablePrivateThumbnailUrl(source)
      )),
    );

    for (const [source, revoke] of Object.entries(cachedThumbnailRevokersRef.current)) {
      if (activeSources.has(source)) continue;
      revoke();
      delete cachedThumbnailRevokersRef.current[source];
      setCachedThumbnailSrcs((prev) => {
        if (!prev[source]) return prev;
        const next = { ...prev };
        delete next[source];
        return next;
      });
    }

    let cancelled = false;
    for (const source of activeSources) {
      if (cachedThumbnailRevokersRef.current[source]) continue;
      void cachedPrivateThumbnailUrl(source).then((cached) => {
        if (!cached) return;
        if (cancelled || cachedThumbnailRevokersRef.current[source]) {
          cached.revoke();
          return;
        }
        cachedThumbnailRevokersRef.current[source] = cached.revoke;
        setCachedThumbnailSrcs((prev) => ({ ...prev, [source]: cached.url }));
      });
    }
    return () => {
      cancelled = true;
    };
  }, [fallbackSrc, primarySrc]);

  useEffect(() => {
    return () => {
      for (const revoke of Object.values(cachedThumbnailRevokersRef.current)) revoke();
      cachedThumbnailRevokersRef.current = {};
    };
  }, []);

  useEffect(() => {
    if (!primaryDelayKey || primaryDelayElapsed) return;
    const timer = setTimeout(() => {
      setDelayedPrimarySrcs((prev) => (
        prev[primaryDelayKey] ? prev : { ...prev, [primaryDelayKey]: true }
      ));
    }, FULL_PREVIEW_LOAD_DELAY_MS);
    return () => clearTimeout(timer);
  }, [primaryDelayKey, primaryDelayElapsed]);

  useEffect(() => {
    if (typeof fallbackSrc !== "string" || fallbackLoaded || fallbackFailed || fallbackTimedOut) return;
    const timer = setTimeout(() => {
      setTimedOutFallbackSrcs((prev) => ({ ...prev, [fallbackSrc]: true }));
    }, FALLBACK_PREVIEW_LOAD_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [fallbackSrc, fallbackLoaded, fallbackFailed, fallbackTimedOut]);

  useEffect(() => {
    if (missingOrFailed || typeof primarySrc !== "string" || isLoaded || canShowFallback || !shouldLoadPrimary) return;
    const timer = setTimeout(() => {
      setFailedSrcs((prev) => ({ ...prev, [primarySrc]: true }));
      onError?.({} as SyntheticEvent<HTMLImageElement, Event>);
    }, IMAGE_PREVIEW_LOAD_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [primarySrc, isLoaded, missingOrFailed, canShowFallback, shouldLoadPrimary, onError]);

  if (missingOrFailed || localHeicUnsupported) {
    return (
      <div className={`${className || ""} flex items-center justify-center bg-[#6C655A]/15 text-[#6C655A]/55 dark:bg-white/[0.04] dark:text-gray-500`}>
        <ImageOff className="h-[45%] max-h-5 min-h-3 w-[45%] max-w-5 min-w-3" aria-hidden="true" />
      </div>
    );
  }

  return (
    <div className={`${className || ""} relative overflow-hidden bg-[#6C655A]/10 dark:bg-white/[0.03]`}>
      {showSpinner && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#f4f1ec]/95 text-[#975428] dark:bg-[#1b1c20]/95 dark:text-white/80" aria-hidden="true">
          <div className="h-8 w-8 rounded-full border-2 border-current/25 border-t-current animate-spin" />
        </div>
      )}
      {typeof fallbackSrc === "string" && (
        <RawImage
          {...props}
          alt=""
          aria-hidden="true"
          src={renderedFallbackSrc}
          loading={effectiveLoading}
          className={`absolute inset-0 h-full w-full ${fitClass} transition-opacity duration-150 ${canShowFallback && !isLoaded ? "opacity-100" : "opacity-0"}`}
          onLoad={() => {
            setLoadedFallbackSrc(fallbackSrc);
          }}
          onError={() => {
            if (signAndRetry(fallbackSrc)) return;
            setFailedSrcs((prev) => ({ ...prev, [fallbackSrc]: true }));
          }}
        />
      )}
      {shouldLoadPrimary && (
        <RawImage
          {...props}
          src={renderedPrimarySrc}
          loading={effectiveLoading}
          className={`absolute inset-0 h-full w-full ${fitClass} transition-opacity duration-150 ${isLoaded ? "opacity-100" : "opacity-0"}`}
          onLoad={(event: SyntheticEvent<HTMLImageElement, Event>) => {
            setLoadedSrc(typeof primarySrc === "string" ? primarySrc : undefined);
            onLoad?.(event);
          }}
          onError={(event: SyntheticEvent<HTMLImageElement, Event>) => {
            if (typeof primarySrc === "string") {
              if (signAndRetry(primarySrc)) return;
              onError?.(event);
              setFailedSrcs((prev) => ({ ...prev, [primarySrc]: true }));
              return;
            }
            onError?.(event);
          }}
        />
      )}
    </div>
  );
}
