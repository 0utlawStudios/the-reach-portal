/**
 * Client-side persistence layer with data versioning.
 *
 * VERSION STRATEGY:
 * - Each store has a version number baked into the key.
 * - If we change the data shape in a future release, we bump the version.
 * - Old versioned data is ignored (graceful fallback to defaults).
 * - This prevents JSON.parse crashes from stale schemas.
 */

const PREFIX = "pt_v1_";

export function loadState<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as T;
    // Basic shape validation: if parsed is null/undefined or wrong type, fallback
    if (parsed === null || parsed === undefined) return fallback;
    if (Array.isArray(fallback) && !Array.isArray(parsed)) return fallback;
    if (typeof fallback === "object" && typeof parsed !== "object") return fallback;
    return parsed;
  } catch {
    // Corrupted data — wipe it and use defaults
    localStorage.removeItem(PREFIX + key);
    return fallback;
  }
}

export function saveState<T>(key: string, value: T): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // localStorage full or blocked — fail silently
  }
}

export function clearState(key: string): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(PREFIX + key);
}

/**
 * Hook-friendly: returns [loaded, data] pattern.
 * `loaded` is false during SSR and first render (hydration safe).
 * `data` is the fallback during SSR, then localStorage data after mount.
 */
export function createPersistentState<T>(key: string, fallback: T) {
  return {
    load: () => loadState(key, fallback),
    save: (value: T) => saveState(key, value),
    clear: () => clearState(key),
  };
}
