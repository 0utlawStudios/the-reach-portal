"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "./supabaseClient";

const CHANGE_EVENT = "reach:manual-posted-moves-changed";

export type ManualPostedMovesSetting = {
  enabled: boolean;
  canToggle: boolean;
};

const DEFAULT_SETTING: ManualPostedMovesSetting = { enabled: false, canToggle: false };
const SETTING_CACHE_MS = 5 * 60 * 1000;

type CacheEntry = {
  setting: ManualPostedMovesSetting;
  loaded: boolean;
  fetchedAt: number;
  promise: Promise<ManualPostedMovesSetting> | null;
};

const settingCache = new Map<string, CacheEntry>();

type IdleCallbackWindow = Window & {
  requestIdleCallback?: (cb: () => void, options?: { timeout?: number }) => number;
  cancelIdleCallback?: (id: number) => void;
};

function cacheKey(workspaceId?: string): string {
  return workspaceId || "default";
}

function cacheEntry(workspaceId?: string): CacheEntry {
  const key = cacheKey(workspaceId);
  const existing = settingCache.get(key);
  if (existing) return existing;
  const created: CacheEntry = {
    setting: DEFAULT_SETTING,
    loaded: false,
    fetchedAt: 0,
    promise: null,
  };
  settingCache.set(key, created);
  return created;
}

async function authHeaders(workspaceId?: string): Promise<HeadersInit> {
  const { data } = await supabase.auth.getSession();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (data.session?.access_token) headers.Authorization = `Bearer ${data.session.access_token}`;
  if (workspaceId) headers["X-Workspace-Id"] = workspaceId;
  return headers;
}

function publish(setting: ManualPostedMovesSetting, workspaceId?: string): void {
  const key = cacheKey(workspaceId);
  const entry = cacheEntry(workspaceId);
  entry.setting = setting;
  entry.loaded = true;
  entry.fetchedAt = Date.now();
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: { key, setting } }));
  }
}

export async function getManualPostedMovesSetting(options: { force?: boolean; workspaceId?: string } = {}): Promise<ManualPostedMovesSetting> {
  const entry = cacheEntry(options.workspaceId);
  const freshEnough = entry.loaded && Date.now() - entry.fetchedAt < SETTING_CACHE_MS;
  if (!options.force && freshEnough) return entry.setting;
  if (!options.force && entry.promise) return entry.promise;
  entry.promise = (async () => {
    try {
      const res = await fetch("/api/admin/manual-posted-settings", {
        method: "GET",
        headers: await authHeaders(options.workspaceId),
        cache: "no-store",
      });
      if (!res.ok) return entry.setting;
      const data = await res.json();
      const setting = {
        enabled: data?.enabled === true,
        canToggle: data?.canToggle === true,
      };
      publish(setting, options.workspaceId);
      return setting;
    } catch (err) {
      console.error("[manual-posted-settings] read failed:", err instanceof Error ? err.message : err);
      return entry.setting;
    } finally {
      entry.promise = null;
    }
  })();
  return entry.promise;
}

export async function setManualPostedMovesEnabled(enabled: boolean, workspaceId?: string): Promise<ManualPostedMovesSetting> {
  const res = await fetch("/api/admin/manual-posted-settings", {
    method: "PATCH",
    headers: await authHeaders(workspaceId),
    body: JSON.stringify({ enabled }),
  });
  if (!res.ok) {
    let message = "Manual Posted setting update failed";
    try {
      const body = await res.json();
      if (typeof body?.error === "string") message = body.error;
    } catch { /* keep fallback */ }
    throw new Error(message);
  }
  const data = await res.json();
  const setting = {
    enabled: data?.enabled === true,
    canToggle: data?.canToggle === true,
  };
  publish(setting, workspaceId);
  return setting;
}

export function useManualPostedMovesSetting(workspaceId?: string): ManualPostedMovesSetting & { loading: boolean; refresh: () => Promise<void> } {
  const key = cacheKey(workspaceId);
  const [setting, setSetting] = useState<ManualPostedMovesSetting>(() => cacheEntry(workspaceId).setting);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setSetting(await getManualPostedMovesSetting({ workspaceId }));
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    setSetting(cacheEntry(workspaceId).setting);
    let idleId: number | undefined;
    let timerId: ReturnType<typeof setTimeout> | undefined;
    const sync = (event?: Event) => {
      const detail = event instanceof CustomEvent ? event.detail : null;
      const next = detail?.key === key ? detail.setting : cacheEntry(workspaceId).setting;
      setSetting({
        enabled: next?.enabled === true,
        canToggle: next?.canToggle === true,
      });
    };
    const w = window as IdleCallbackWindow;
    const refreshWhenIdle = () => { void refresh(); };
    if (w.requestIdleCallback) {
      idleId = w.requestIdleCallback(refreshWhenIdle, { timeout: 2500 });
    } else {
      timerId = setTimeout(refreshWhenIdle, 1200);
    }
    window.addEventListener(CHANGE_EVENT, sync);
    return () => {
      if (idleId !== undefined && w.cancelIdleCallback) w.cancelIdleCallback(idleId);
      if (timerId) clearTimeout(timerId);
      window.removeEventListener(CHANGE_EVENT, sync);
    };
  }, [key, refresh, workspaceId]);

  return { ...setting, loading, refresh };
}

export function useManualPostedMovesEnabled(workspaceId?: string): boolean {
  return useManualPostedMovesSetting(workspaceId).enabled;
}
