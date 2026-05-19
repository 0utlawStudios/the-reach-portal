"use client";

import { useEffect } from "react";

type RequestIdleCallbackWindow = Window & {
  requestIdleCallback?: (cb: () => void) => number;
  cancelIdleCallback?: (id: number) => void;
};

export function ServiceWorkerRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const w = window as RequestIdleCallbackWindow;
    let idleId: number | undefined;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    if (w.requestIdleCallback) {
      idleId = w.requestIdleCallback(() => {
        navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" }).catch(() => {});
      });
    } else {
      timeoutId = setTimeout(() => {
        navigator.serviceWorker.register("/sw.js").catch(() => {});
      }, 1000);
    }
    return () => {
      if (idleId !== undefined && w.cancelIdleCallback) w.cancelIdleCallback(idleId);
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, []);
  return null;
}
