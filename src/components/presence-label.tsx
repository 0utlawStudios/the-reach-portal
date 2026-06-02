"use client";

// PresenceLabel — renders the active label following the spec's hierarchy:
//   1. Live channel state    → "Active now" / "Idle" / "Away"
//   2. presence_last_seen    → "Last seen X · HH:MM CST"
//   3. audit_last            → "Last seen X · HH:MM CST" (same formatter)
//   4. auth_last_sign_in     → "Last signed in Mon DD"
//   5. none                  → "Never signed in"
//
// Steps 2 and 3 both use the "last seen" formatter; the only difference is
// which underlying timestamp wins. The view's `best_known_seen` is the
// pre-computed GREATEST(presence, audit, signin) — we use that for the
// numeric value and fall back to the individual columns to label which
// signal we believe.
//
// Times render in America/Chicago because The Reach ops reports there.
// Replace TIMEZONE below if your reporting tz differs.

import { useEffect, useState } from "react";
import { usePresence } from "@/lib/use-presence";
import type { PresenceStatus, PresenceSummaryRow } from "@/lib/use-presence";

const TIMEZONE = "America/Chicago";
const TZ_LABEL = "CST";

// Module-level subscription so every label re-renders together on the same
// tick without each component running its own interval (cheaper at scale).
const tickSubscribers = new Set<() => void>();
let tickIntervalStarted = false;
function ensureTick() {
  if (tickIntervalStarted || typeof window === "undefined") return;
  tickIntervalStarted = true;
  setInterval(() => {
    for (const cb of tickSubscribers) cb();
  }, 60 * 1000);
}

function useMinuteTick() {
  const [, setBump] = useState(0);
  useEffect(() => {
    ensureTick();
    const cb = () => setBump((n) => (n + 1) % 1_000_000);
    tickSubscribers.add(cb);
    return () => {
      tickSubscribers.delete(cb);
    };
  }, []);
}

function fmtTime(d: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: TIMEZONE,
  }).format(d);
}

function fmtMonthDay(d: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: TIMEZONE,
  }).format(d);
}

function fmtWeekday(d: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    timeZone: TIMEZONE,
  }).format(d);
}

function relativeLastSeen(iso: string): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "Not set";
  const ageMs = Date.now() - t;
  if (ageMs < 60 * 1000) return "just now";
  if (ageMs < 60 * 60 * 1000) {
    const mins = Math.floor(ageMs / 60000);
    return `${mins} min ago`;
  }
  if (ageMs < 24 * 60 * 60 * 1000) {
    const hrs = Math.floor(ageMs / 3_600_000);
    return `${hrs} hour${hrs === 1 ? "" : "s"} ago · ${fmtTime(new Date(t))} ${TZ_LABEL}`;
  }
  if (ageMs < 7 * 24 * 60 * 60 * 1000) {
    return `${fmtWeekday(new Date(t))} at ${fmtTime(new Date(t))} ${TZ_LABEL}`;
  }
  return `${fmtMonthDay(new Date(t))} at ${fmtTime(new Date(t))} ${TZ_LABEL}`;
}

function signInLabel(iso: string): string {
  return `Last signed in ${fmtMonthDay(new Date(iso))}`;
}

function liveLabel(status: PresenceStatus): string {
  if (status === "active") return "Active now";
  if (status === "idle") return "Idle";
  if (status === "away") return "Away";
  return "";
}

export function resolvePresenceLabel(
  status: PresenceStatus,
  summary: PresenceSummaryRow | undefined,
): { text: string; tone: "live" | "recent" | "older" | "never" } {
  if (status === "active" || status === "idle" || status === "away") {
    return { text: liveLabel(status), tone: "live" };
  }
  const best = summary?.best_known_seen
    ?? summary?.presence_last_seen
    ?? summary?.audit_last
    ?? summary?.auth_last_sign_in
    ?? null;
  if (best) {
    const ageMs = Date.now() - new Date(best).getTime();
    // If the freshest signal is the auth sign-in (because audit + presence
    // are both null), label it differently — "signed in" is weaker than
    // "last seen" since auth.users.last_sign_in_at is known to be stale.
    const presence = summary?.presence_last_seen ?? null;
    const audit = summary?.audit_last ?? null;
    if (!presence && !audit && summary?.auth_last_sign_in) {
      return { text: signInLabel(summary.auth_last_sign_in), tone: "older" };
    }
    return {
      text: `Last seen ${relativeLastSeen(best)}`,
      tone: ageMs < 24 * 60 * 60 * 1000 ? "recent" : "older",
    };
  }
  return { text: "Never signed in", tone: "never" };
}

export function PresenceLabel({
  email,
  className,
}: {
  email: string;
  className?: string;
}) {
  useMinuteTick();
  const { getStatus, getSummary } = usePresence();
  const status = getStatus(email);
  const summary = getSummary(email);
  const { text, tone } = resolvePresenceLabel(status, summary);

  const toneClass =
    tone === "live"
      ? "text-emerald-600 dark:text-emerald-400"
      : tone === "recent"
        ? "text-gray-500 dark:text-gray-400"
        : tone === "older"
          ? "text-gray-400 dark:text-gray-500"
          : "text-gray-300 dark:text-gray-600";

  return <span className={`${toneClass} ${className ?? ""}`}>{text}</span>;
}
