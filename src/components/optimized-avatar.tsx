"use client";

import { useMemo, useState } from "react";
import { RawImage } from "@/components/raw-image";

interface OptimizedAvatarProps {
  src?: string | null;
  name: string;
  width: number;
  height: number;
  className: string;
  fallbackClassName: string;
  eager?: boolean;
}

function initials(name: string): string {
  const value = name
    .trim()
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return value || "?";
}

export function OptimizedAvatar({
  src,
  name,
  width,
  height,
  className,
  fallbackClassName,
  eager = false,
}: OptimizedAvatarProps) {
  const [failed, setFailed] = useState(false);
  const label = useMemo(() => initials(name), [name]);

  if (!src || failed) {
    return (
      <div className={fallbackClassName} style={{ width, height }}>
        {label}
      </div>
    );
  }

  return (
    <RawImage
      src={src}
      alt={name}
      width={width}
      height={height}
      loading={eager ? "eager" : "lazy"}
      decoding="async"
      className={className}
      onError={() => setFailed(true)}
    />
  );
}
