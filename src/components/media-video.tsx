"use client";

import type { SyntheticEvent, VideoHTMLAttributes } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Film } from "lucide-react";

type MediaVideoProps = Omit<VideoHTMLAttributes<HTMLVideoElement>, "src"> & {
  sources: Array<string | null | undefined>;
  label?: string;
  loadTimeoutMs?: number;
};

const DEFAULT_VIDEO_LOAD_TIMEOUT_MS = 10_000;

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
  const [failedSources, setFailedSources] = useState<Record<string, true>>({});
  const [loadedSource, setLoadedSource] = useState<string | null>(null);
  const currentSource = usableSources.find((source) => !failedSources[source]);
  const loaded = Boolean(currentSource && loadedSource === currentSource);

  const advanceSource = useCallback(() => {
    if (!currentSource) return;
    setFailedSources((prev) => ({ ...prev, [currentSource]: true }));
  }, [currentSource]);

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
        setLoadedSource(currentSource);
        onLoadedMetadata?.(event);
      }}
      onCanPlay={(event: SyntheticEvent<HTMLVideoElement, Event>) => {
        setLoadedSource(currentSource);
        onCanPlay?.(event);
      }}
      onError={(event: SyntheticEvent<HTMLVideoElement, Event>) => {
        onError?.(event);
        advanceSource();
      }}
    />
  );
}
