// Single source of truth for whether AI generation is enabled.
//
// Operational kill switch — set `STUDIO_ENABLED=false` in Vercel env vars
// (Production scope) to disable the AI worker in ~30 seconds without
// reverting code.
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
  "AI generation is temporarily disabled. Contact an admin if this is unexpected.";
