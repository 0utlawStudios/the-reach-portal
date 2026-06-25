"use client";

import type { SyntheticEvent, VideoHTMLAttributes } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Film, RotateCcw } from "lucide-react";
import { isPrivateMediaRouteUrl, signedMediaViewUrl } from "@/lib/media-view-url";

type MediaVideoProps = Omit<VideoHTMLAttributes<HTMLVideoElement>, "src"> & {
  sources: Array<string | null | undefined>;
  label?: string;
  loadTimeoutMs?: number;
};

const DEFAULT_VIDEO_LOAD_TIMEOUT_MS = 45_000;

type PlaybackState = {
  sourceKey: string;
  failedSources: Record<string, true>;
  loadedSource: string | null;
  attemptedSource: string | null;
};

function uniqueSources(sources: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const next: string[] = [];
  for (const source of sources) {
    if (!source || seen.has(source)) continue;
    seen.add(source);
    next.push(source);
  }
  return next;
}

export function MediaVideo({
  sources,
  label = "Video preview",
  className,
  loadTimeoutMs = DEFAULT_VIDEO_LOAD_TIMEOUT_MS,
  onError,
  onLoadStart,
  onLoadedData,
  onLoadedMetadata,
  onCanPlay,
  onPlay,
  preload,
  style,
  ...props
}: MediaVideoProps) {
  const usableSources = useMemo(() => uniqueSources(sources), [sources]);
  const sourceKey = usableSources.join("\n");
  const [signedSources, setSignedSources] = useState<Record<string, string>>({});
  const [signingSources, setSigningSources] = useState<Record<string, true>>({});
  const [playbackState, setPlaybackState] = useState<PlaybackState>({
    sourceKey: "",
    failedSources: {},
    loadedSource: null,
    attemptedSource: null,
  });
  const activeState =
    playbackState.sourceKey === sourceKey
      ? playbackState
      : { sourceKey, failedSources: {}, loadedSource: null, attemptedSource: null };
  const { failedSources, loadedSource } = activeState;
  const currentSource = usableSources.find((source) => !failedSources[source]);
  const renderedSource = currentSource ? signedSources[currentSource] || currentSource : undefined;
  const loaded = Boolean(currentSource && loadedSource === currentSource);
  const attempted = Boolean(currentSource && activeState.attemptedSource === currentSource);
  const shouldWatchLoad = Boolean(currentSource && !loaded && (preload !== "none" || attempted));

  const retrySources = useCallback(() => {
    setPlaybackState({ sourceKey, failedSources: {}, loadedSource: null, attemptedSource: null });
  }, [sourceKey]);

  const signAndRetryCurrentSource = useCallback((source: string): boolean => {
    if (!isPrivateMediaRouteUrl(source) || signedSources[source] || signingSources[source]) return false;
    setSigningSources((prev) => ({ ...prev, [source]: true }));
    void signedMediaViewUrl(source)
      .then((signedUrl) => {
        if (!signedUrl) {
          setPlaybackState((prev) => {
            const base =
              prev.sourceKey === sourceKey
                ? prev
                : { sourceKey, failedSources: {}, loadedSource: null, attemptedSource: null };
            return {
              sourceKey,
              failedSources: { ...base.failedSources, [source]: true },
              loadedSource: base.loadedSource === source ? null : base.loadedSource,
              attemptedSource: base.attemptedSource === source ? null : base.attemptedSource,
            };
          });
          return;
        }
        setSignedSources((prev) => ({ ...prev, [source]: signedUrl }));
        setPlaybackState((prev) => ({
          sourceKey,
          failedSources: prev.sourceKey === sourceKey ? prev.failedSources : {},
          loadedSource: prev.sourceKey === sourceKey ? prev.loadedSource : null,
          attemptedSource: source,
        }));
      })
      .catch(() => {
        setPlaybackState((prev) => {
          const base =
            prev.sourceKey === sourceKey
              ? prev
              : { sourceKey, failedSources: {}, loadedSource: null, attemptedSource: null };
          return {
            sourceKey,
            failedSources: { ...base.failedSources, [source]: true },
            loadedSource: base.loadedSource === source ? null : base.loadedSource,
            attemptedSource: base.attemptedSource === source ? null : base.attemptedSource,
          };
        });
      })
      .finally(() => {
        setSigningSources((prev) => {
          const next = { ...prev };
          delete next[source];
          return next;
        });
      });
    return true;
  }, [signedSources, signingSources, sourceKey]);

  const advanceSource = useCallback(() => {
    if (!currentSource) return;
    if (signAndRetryCurrentSource(currentSource)) return;
    setPlaybackState((prev) => {
      const base =
        prev.sourceKey === sourceKey
          ? prev
          : { sourceKey, failedSources: {}, loadedSource: null, attemptedSource: null };
      return {
        sourceKey,
        failedSources: { ...base.failedSources, [currentSource]: true },
        loadedSource: base.loadedSource === currentSource ? null : base.loadedSource,
        attemptedSource: base.attemptedSource === currentSource ? null : base.attemptedSource,
      };
    });
  }, [currentSource, signAndRetryCurrentSource, sourceKey]);

  const markAttempted = useCallback(() => {
    if (!currentSource) return;
    setPlaybackState((prev) => ({
      sourceKey,
      failedSources: prev.sourceKey === sourceKey ? prev.failedSources : {},
      loadedSource: prev.sourceKey === sourceKey ? prev.loadedSource : null,
      attemptedSource: currentSource,
    }));
  }, [currentSource, sourceKey]);

  const markLoaded = useCallback(() => {
    if (!currentSource) return;
    setPlaybackState((prev) => ({
      sourceKey,
      failedSources: prev.sourceKey === sourceKey ? prev.failedSources : {},
      loadedSource: currentSource,
      attemptedSource: currentSource,
    }));
  }, [currentSource, sourceKey]);

  useEffect(() => {
    if (!shouldWatchLoad) return;
    const timer = setTimeout(advanceSource, loadTimeoutMs);
    return () => clearTimeout(timer);
  }, [advanceSource, loadTimeoutMs, shouldWatchLoad]);

  if (!currentSource) {
    return (
      <div className={`${className || ""} flex min-h-24 min-w-32 flex-col items-center justify-center gap-2 bg-[#111] text-white/65`}>
        <Film className="h-6 w-6" aria-hidden="true" />
        <span className="px-3 text-center text-[11px] font-medium">Video preview unavailable</span>
        {usableSources.length > 0 && (
          <button
            type="button"
            onClick={retrySources}
            className="inline-flex items-center gap-1 rounded-md border border-white/15 px-2 py-1 text-[10px] font-medium text-white/80 transition-colors hover:bg-white/10"
          >
            <RotateCcw className="h-3 w-3" aria-hidden="true" />
            Retry
          </button>
        )}
      </div>
    );
  }

  return (
    <video
      {...props}
      src={renderedSource}
      className={className}
      preload={preload}
      style={{ backgroundColor: "#18181b", ...style }}
      aria-label={props["aria-label"] || label}
      onLoadStart={(event: SyntheticEvent<HTMLVideoElement, Event>) => {
        markAttempted();
        onLoadStart?.(event);
      }}
      onLoadedMetadata={(event: SyntheticEvent<HTMLVideoElement, Event>) => {
        onLoadedMetadata?.(event);
      }}
      onLoadedData={(event: SyntheticEvent<HTMLVideoElement, Event>) => {
        markLoaded();
        onLoadedData?.(event);
      }}
      onCanPlay={(event: SyntheticEvent<HTMLVideoElement, Event>) => {
        markLoaded();
        onCanPlay?.(event);
      }}
      onPlay={(event: SyntheticEvent<HTMLVideoElement, Event>) => {
        markAttempted();
        onPlay?.(event);
      }}
      onError={(event: SyntheticEvent<HTMLVideoElement, Event>) => {
        onError?.(event);
        advanceSource();
      }}
    />
  );
}
