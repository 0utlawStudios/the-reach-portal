import type { ImgHTMLAttributes } from "react";

// PERF-008: default to lazy + async-decoding for every <img> in the app.
// Callers can still override (e.g. above-the-fold logos) by passing explicit
// loading/decoding props.
export function RawImage({ alt, loading = "lazy", decoding = "async", ...props }: ImgHTMLAttributes<HTMLImageElement>) {
  // Always emit a non-empty alt for accessibility: prefer the caller's value,
  // fall back to a generic label if nothing was provided. Decorative images
  // can opt out by passing alt="" explicitly.
  const resolvedAlt = typeof alt === "string" ? alt : "Image";
  // eslint-disable-next-line @next/next/no-img-element -- existing remote and blob image layout must stay unchanged during lint cleanup
  return <img alt={resolvedAlt} loading={loading} decoding={decoding} {...props} />;
}
