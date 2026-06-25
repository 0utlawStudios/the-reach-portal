import { createHmac, timingSafeEqual } from "node:crypto";

const AI_ASSET_TOKEN_VERSION = "v1";
const AI_ASSET_PUBLISH_TOKEN_TTL_MS = 365 * 24 * 60 * 60 * 1000;

function signingSecret(): string {
  const secret =
    process.env.AI_ASSET_SIGNING_SECRET ||
    (process.env.NODE_ENV === "production"
      ? ""
      : process.env.DRIVE_STREAM_SIGNING_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (!secret) throw new Error("AI asset signing secret is not configured");
  return secret;
}

function publicBaseUrl(): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL || process.env.VERCEL_URL || "";
  if (!configured) return "http://localhost:3000";
  const withScheme = /^https?:\/\//i.test(configured) ? configured : `https://${configured}`;
  return withScheme.replace(/\/+$/, "");
}

function signPayload(storageKey: string, expiresAt: number): string {
  return createHmac("sha256", signingSecret())
    .update(`${storageKey}.${expiresAt}`)
    .digest("base64url");
}

export function signAiAssetToken(
  storageKey: string,
  expiresAt = Date.now() + AI_ASSET_PUBLISH_TOKEN_TTL_MS,
): string {
  return `${AI_ASSET_TOKEN_VERSION}.${expiresAt}.${signPayload(storageKey, expiresAt)}`;
}

export function verifyAiAssetToken(storageKey: string, token: string | null | undefined): { expiresAt: number } | null {
  if (!token) return null;
  try {
    const [version, expiresAtRaw, signature] = token.split(".");
    if (version !== AI_ASSET_TOKEN_VERSION || !expiresAtRaw || !signature) return null;
    const expiresAt = Number(expiresAtRaw);
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return null;
    const expected = signPayload(storageKey, expiresAt);
    const a = Buffer.from(expected);
    const b = Buffer.from(signature);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    return { expiresAt };
  } catch {
    return null;
  }
}

export function aiAssetPublishUrl(storageKey: string): string {
  const params = new URLSearchParams({
    key: storageKey,
    token: signAiAssetToken(storageKey),
  });
  return `${publicBaseUrl()}/api/ai/asset?${params.toString()}`;
}
