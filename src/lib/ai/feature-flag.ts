// Single source of truth for whether Creator Studio is enabled.
//
// Operational kill switch — set `STUDIO_ENABLED=false` in Vercel env vars
// (Production scope) to disable the entire feature in ~30 seconds without
// reverting code. Every /api/ai/* route returns 503 when off, the sidebar
// link is hidden, the Settings access panel is hidden, and the GET
// /api/ai/studio/access endpoint reports `feature_disabled` so the UI can
// render a clean disabled state instead of leaking 403s.
//
// Default: enabled. We explicitly check for the literal strings "false"
// or "0" so an accidental empty-string env var doesn't disable the
// feature.

export function studioEnabled(): boolean {
  const raw = (process.env.STUDIO_ENABLED || "").toLowerCase().trim();
  if (raw === "false" || raw === "0" || raw === "off" || raw === "no") return false;
  return true;
}

export const STUDIO_DISABLED_MESSAGE =
  "Creator Studio is temporarily disabled. Contact an admin if this is unexpected.";
