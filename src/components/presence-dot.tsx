"use client";

// PresenceDot — 4 visually distinct variants (color + shape) for color-blind
// accessibility. Designed to sit at the bottom-right of an avatar.
//
//   active:  emerald solid, pulsing halo
//   idle:    amber solid (smaller)
//   away:    hollow orange ring
//   offline: grey solid (smallest)
//
// Each variant is distinguishable WITHOUT relying on color alone. Active has
// a pulse animation, away has an open ring, offline is shrunken.

import type { PresenceStatus } from "@/lib/use-presence";

export function PresenceDot({
  status,
  size = "md",
  title,
}: {
  status: PresenceStatus;
  size?: "sm" | "md";
  title?: string;
}) {
  const px = size === "sm" ? "w-2 h-2" : "w-2.5 h-2.5";
  const ringPx = size === "sm" ? "w-2 h-2" : "w-2.5 h-2.5";

  const label =
    title ??
    (status === "active"
      ? "Active now"
      : status === "idle"
        ? "Idle"
        : status === "away"
          ? "Away"
          : "Offline");

  const base =
    "absolute -bottom-0.5 -right-0.5 rounded-full ring-2 ring-white dark:ring-[#0a0a0e] shadow-sm";

  if (status === "active") {
    return (
      <span title={label} aria-label={label} className={`${base} ${px} bg-emerald-500`}>
        <span className="absolute inset-0 rounded-full bg-emerald-400 animate-ping opacity-60" />
      </span>
    );
  }

  if (status === "idle") {
    return (
      <span title={label} aria-label={label} className={`${base} ${px} bg-amber-400`} />
    );
  }

  if (status === "away") {
    return (
      <span
        title={label}
        aria-label={label}
        className={`${base} ${ringPx} bg-transparent border-2 border-orange-500`}
        style={{ boxSizing: "border-box" }}
      />
    );
  }

  return (
    <span
      title={label}
      aria-label={label}
      className={`${base} w-1.5 h-1.5 bg-gray-400 dark:bg-gray-600`}
    />
  );
}
