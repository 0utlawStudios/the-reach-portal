"use client";

import type { SyntheticEvent, VideoHTMLAttributes } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Film, RotateCcw } from "lucide-react";

type MediaVideoProps = Omit<VideoHTMLAttributes<HTMLVideoElement>, "src"> & {
  sources: Array<string | null | undefined>;
  label?: string;
  loadTimeoutMs?: number;
};

const DEFAULT_VIDEO_LOAD_TIMEOUT_MS = 10_000;

type PlaybackState = {
  sourceKey: string;
  failedSources: Record<string, true>;
  loadedSource: string | null;
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
  onLoadedMetadata,
  onCanPlay,
  ...props
}: MediaVideoProps) {
  const usableSources = useMemo(() => uniqueSources(sources), [sources]);
  const sourceKey = usableSources.join("\n");
  const [playbackState, setPlaybackState] = useState<PlaybackState>({
    sourceKey: "",
    failedSources: {},
    loadedSource: null,
  });
  const activeState =
    playbackState.sourceKey === sourceKey
      ? playbackState
      : { sourceKey, failedSources: {}, loadedSource: null };
  const { failedSources, loadedSource } = activeState;
  const currentSource = usableSources.find((source) => !failedSources[source]);
  const loaded = Boolean(currentSource && loadedSource === currentSource);

  const retrySources = useCallback(() => {
    setPlaybackState({ sourceKey, failedSources: {}, loadedSource: null });
  }, [sourceKey]);

  const advanceSource = useCallback(() => {
    if (!currentSource) return;
    setPlaybackState((prev) => {
      const base =
        prev.sourceKey === sourceKey
          ? prev
          : { sourceKey, failedSources: {}, loadedSource: null };
      return {
        sourceKey,
        failedSources: { ...base.failedSources, [currentSource]: true },
        loadedSource: base.loadedSource === currentSource ? null : base.loadedSource,
      };
    });
  }, [currentSource, sourceKey]);

  const markLoaded = useCallback(() => {
    if (!currentSource) return;
    setPlaybackState((prev) => ({
      sourceKey,
      failedSources: prev.sourceKey === sourceKey ? prev.failedSources : {},
      loadedSource: currentSource,
    }));
  }, [currentSource, sourceKey]);

  useEffect(() => {
    if (!currentSource || loaded) return;
    const timer = setTimeout(advanceSource, loadTimeoutMs);
    return () => clearTimeout(timer);
  }, [advanceSource, currentSource, loadTimeoutMs, loaded]);

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
      src={currentSource}
      className={className}
      aria-label={props["aria-label"] || label}
      onLoadedMetadata={(event: SyntheticEvent<HTMLVideoElement, Event>) => {
        markLoaded();
        onLoadedMetadata?.(event);
      }}
      onCanPlay={(event: SyntheticEvent<HTMLVideoElement, Event>) => {
        markLoaded();
        onCanPlay?.(event);
      }}
      onError={(event: SyntheticEvent<HTMLVideoElement, Event>) => {
        onError?.(event);
        advanceSource();
      }}
    />
  );
}
