import { createHmac, timingSafeEqual } from "node:crypto";

const PLAYBACK_VIEW_TOKEN_VERSION = "v1";
const PLAYBACK_VIEW_TOKEN_TTL_MS = 15 * 60 * 1000;
const WORKSPACE_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function signingSecret(): string {
  const secret =
    process.env.MEDIA_PLAYBACK_SIGNING_SECRET ||
    (process.env.NODE_ENV === "production"
      ? ""
      : process.env.DRIVE_STREAM_SIGNING_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (!secret) throw new Error("Media playback signing secret is not configured");
  return secret;
}

function payload(storageKey: string, workspaceId: string, expiresAt: number): string {
  return ["playback-view", storageKey, workspaceId, String(expiresAt)].join("\n");
}

function signature(storageKey: string, workspaceId: string, expiresAt: number): string {
  return createHmac("sha256", signingSecret())
    .update(payload(storageKey, workspaceId, expiresAt))
    .digest("base64url");
}

export function signPlaybackViewToken(
  storageKey: string,
  workspaceId: string,
  expiresAt = Date.now() + PLAYBACK_VIEW_TOKEN_TTL_MS,
): string {
  return `${PLAYBACK_VIEW_TOKEN_VERSION}.${expiresAt}.${workspaceId}.${signature(storageKey, workspaceId, expiresAt)}`;
}

export function verifyPlaybackViewToken(
  storageKey: string,
  token: string | null | undefined,
): { workspaceId: string; expiresAt: number } | null {
  if (!token) return null;
  try {
    const [version, expiresAtRaw, workspaceId, tokenSignature] = token.split(".");
    if (version !== PLAYBACK_VIEW_TOKEN_VERSION || !expiresAtRaw || !workspaceId || !tokenSignature) return null;
    if (!WORKSPACE_ID_RE.test(workspaceId)) return null;
    const expiresAt = Number(expiresAtRaw);
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return null;
    const expected = signature(storageKey, workspaceId, expiresAt);
    const a = Buffer.from(expected);
    const b = Buffer.from(tokenSignature);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    return { workspaceId, expiresAt };
  } catch {
    return null;
  }
}
