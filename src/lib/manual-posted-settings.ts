"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "./supabaseClient";

const CHANGE_EVENT = "reach:manual-posted-moves-changed";

export type ManualPostedMovesSetting = {
  enabled: boolean;
  canToggle: boolean;
};

const DEFAULT_SETTING: ManualPostedMovesSetting = { enabled: false, canToggle: false };
let cachedSetting: ManualPostedMovesSetting = DEFAULT_SETTING;
let cachedSettingLoaded = false;
let cachedSettingFetchedAt = 0;
let cachedSettingPromise: Promise<ManualPostedMovesSetting> | null = null;
const SETTING_CACHE_MS = 5 * 60 * 1000;

type IdleCallbackWindow = Window & {
  requestIdleCallback?: (cb: () => void, options?: { timeout?: number }) => number;
  cancelIdleCallback?: (id: number) => void;
};

async function authHeaders(): Promise<HeadersInit> {
  const { data } = await supabase.auth.getSession();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (data.session?.access_token) headers.Authorization = `Bearer ${data.session.access_token}`;
  return headers;
}

function publish(setting: ManualPostedMovesSetting): void {
  cachedSetting = setting;
  cachedSettingLoaded = true;
  cachedSettingFetchedAt = Date.now();
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: setting }));
  }
}

export async function getManualPostedMovesSetting(options: { force?: boolean } = {}): Promise<ManualPostedMovesSetting> {
  const freshEnough = cachedSettingLoaded && Date.now() - cachedSettingFetchedAt < SETTING_CACHE_MS;
  if (!options.force && freshEnough) return cachedSetting;
  if (!options.force && cachedSettingPromise) return cachedSettingPromise;
  cachedSettingPromise = (async () => {
    try {
      const res = await fetch("/api/admin/manual-posted-settings", {
        method: "GET",
        headers: await authHeaders(),
        cache: "no-store",
      });
      if (!res.ok) return cachedSetting;
      const data = await res.json();
      const setting = {
        enabled: data?.enabled === true,
        canToggle: data?.canToggle === true,
      };
      publish(setting);
      return setting;
    } catch (err) {
      console.error("[manual-posted-settings] read failed:", err instanceof Error ? err.message : err);
      return cachedSetting;
    } finally {
      cachedSettingPromise = null;
    }
  })();
  return cachedSettingPromise;
}

export async function setManualPostedMovesEnabled(enabled: boolean): Promise<ManualPostedMovesSetting> {
  const res = await fetch("/api/admin/manual-posted-settings", {
    method: "PATCH",
    headers: await authHeaders(),
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
  publish(setting);
  return setting;
}

export function useManualPostedMovesSetting(): ManualPostedMovesSetting & { loading: boolean; refresh: () => Promise<void> } {
  const [setting, setSetting] = useState<ManualPostedMovesSetting>(cachedSetting);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setSetting(await getManualPostedMovesSetting());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let idleId: number | undefined;
    let timerId: ReturnType<typeof setTimeout> | undefined;
    const sync = (event?: Event) => {
      const detail = event instanceof CustomEvent ? event.detail : cachedSetting;
      setSetting({
        enabled: detail?.enabled === true,
        canToggle: detail?.canToggle === true,
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
  }, [refresh]);

  return { ...setting, loading, refresh };
}

export function useManualPostedMovesEnabled(): boolean {
  return useManualPostedMovesSetting().enabled;
}
