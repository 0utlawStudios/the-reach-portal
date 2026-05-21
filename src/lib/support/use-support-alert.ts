"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useAuth } from "@/lib/auth-context";
import type { SupportThreadRow } from "./types";

export const SUPPORT_ALERT_REFRESH_EVENT = "support-alert-refresh";

function emitSupportAlertRefresh() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(SUPPORT_ALERT_REFRESH_EVENT));
}

export function refreshSupportAlert() {
  emitSupportAlertRefresh();
}

function rowNeedsAttention(row: Partial<SupportThreadRow>): boolean {
  return Boolean(
    row.unread_for_admin ||
      (row.kind === "ticket" && row.status === "open" && !row.admin_last_read_at),
  );
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
  const { accessToken, provisionResult } = useAuth();
  const workspaceId = provisionResult?.workspaceId || null;
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
    const interval = window.setInterval(() => void refresh(), 90 * 1000);
    return () => {
      window.removeEventListener(SUPPORT_ALERT_REFRESH_EVENT, onRefresh);
      window.removeEventListener("focus", onRefresh);
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(interval);
    };
  }, [accessToken, enabled, refresh]);

  useEffect(() => {
    if (!enabled || !workspaceId || !accessToken) return;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    const cancelIdle = onIdle(() => {
      channel = supabase
        .channel(`support-alert-${workspaceId}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "support_threads", filter: `workspace_id=eq.${workspaceId}` },
          (payload) => {
            if (payload.eventType === "INSERT" || payload.eventType === "UPDATE") {
              const row = payload.new as SupportThreadRow;
              if (rowNeedsAttention(row)) {
                setHasAlert(true);
                return;
              }
            }
            void refresh();
          },
        )
        .subscribe();
    });
    return () => {
      cancelIdle();
      if (channel) void supabase.removeChannel(channel);
    };
  }, [accessToken, enabled, refresh, workspaceId]);

  return { hasAlert: enabled ? hasAlert : false, refresh };
}
