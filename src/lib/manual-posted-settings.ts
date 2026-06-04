"use client";

import { useEffect, useState } from "react";
import { loadState, saveState } from "./persistence";

const STORAGE_KEY = "manual_posted_moves_enabled";
const CHANGE_EVENT = "reach:manual-posted-moves-changed";

export function getManualPostedMovesEnabled(): boolean {
  return loadState<boolean>(STORAGE_KEY, false) === true;
}

export function setManualPostedMovesEnabled(enabled: boolean): void {
  saveState(STORAGE_KEY, enabled);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: { enabled } }));
  }
}

export function useManualPostedMovesEnabled(): boolean {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    const sync = () => setEnabled(getManualPostedMovesEnabled());
    sync();
    window.addEventListener(CHANGE_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(CHANGE_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  return enabled;
}
