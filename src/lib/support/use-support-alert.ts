"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";

export const SUPPORT_ALERT_REFRESH_EVENT = "support-alert-refresh";
const SUPPORT_ALERT_POLL_MS = 90 * 1000;

function emitSupportAlertRefresh() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(SUPPORT_ALERT_REFRESH_EVENT));
}

export function refreshSupportAlert() {
  emitSupportAlertRefresh();
}

function onIdle(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const w = window as typeof window & {
    requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
    cancelIdleCallback?: (handle: number) => void;
  };
  if (typeof w.requestIdleCallback === "function") {
    const handle = w.requestIdleCallback(cb, { timeout: 2000 });
    return () => w.cancelIdleCallback?.(handle);
  }
  const t = window.setTimeout(cb, 1000);
  return () => window.clearTimeout(t);
}

export function useSupportAlert(enabled: boolean) {
  const { accessToken } = useAuth();
  const [hasAlert, setHasAlert] = useState(false);

  const refresh = useCallback(async () => {
    if (!enabled || !accessToken) {
      return;
    }
    try {
      const res = await fetch("/api/support/alert", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) return;
      const json = (await res.json()) as { hasAlert?: boolean };
      setHasAlert(Boolean(json.hasAlert));
    } catch (err) {
      console.error("[support-alert] refresh failed:", err);
    }
  }, [accessToken, enabled]);

  useEffect(() => {
    if (!enabled || !accessToken) return;
    return onIdle(() => void refresh());
  }, [accessToken, enabled, refresh]);

  useEffect(() => {
    if (!enabled || !accessToken) return;
    const onRefresh = () => void refresh();
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    window.addEventListener(SUPPORT_ALERT_REFRESH_EVENT, onRefresh);
    window.addEventListener("focus", onRefresh);
    document.addEventListener("visibilitychange", onVisible);
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, SUPPORT_ALERT_POLL_MS);
    return () => {
      window.removeEventListener(SUPPORT_ALERT_REFRESH_EVENT, onRefresh);
      window.removeEventListener("focus", onRefresh);
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(interval);
    };
  }, [accessToken, enabled, refresh]);

  // Intentionally no postgres_changes subscription here. The sidebar dot is a
  // tiny alert, not a live inbox, so it uses one indexed API check on focus,
  // on local support mutations, and at a visible-tab cadence. This keeps the
  // always-mounted sidebar from adding a permanent Realtime polling stream.
  return { hasAlert: enabled ? hasAlert : false, refresh };
}
