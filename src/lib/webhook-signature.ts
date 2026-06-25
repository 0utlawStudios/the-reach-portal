import { createHmac, timingSafeEqual } from "node:crypto";
import { consume } from "@/lib/rate-limit";

const DEFAULT_MAX_SKEW_MS = 5 * 60 * 1000;
const seenNonces = new Map<string, number>();

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
}

function purgeExpiredNonces(now: number) {
  for (const [key, expiresAt] of seenNonces.entries()) {
    if (expiresAt <= now) seenNonces.delete(key);
  }
}

export function signWebhookBody(params: {
  secret: string;
  timestamp: string;
  nonce: string;
  body: string;
}): string {
  const payload = `${params.timestamp}.${params.nonce}.${params.body}`;
  const digest = createHmac("sha256", params.secret).update(payload).digest("hex");
  return `v1=${digest}`;
}

export function readWebhookNonce(headers: Headers): string {
  return (headers.get("x-webhook-nonce") || headers.get("x-publisher-nonce") || "").trim();
}

export async function reserveDurableWebhookNonce(headers: Headers, scope: string, windowSeconds = 5 * 60): Promise<boolean> {
  const nonce = readWebhookNonce(headers);
  if (!nonce || nonce.length > 200) return false;
  const result = await consume(`webhook-nonce:${scope}`, `${scope}:${nonce}`, 1, windowSeconds, { onError: "deny" });
  return result.allowed;
}

export function verifyWebhookSignature(headers: Headers, body: string, secret: string, scope: string, maxSkewMs = DEFAULT_MAX_SKEW_MS): boolean {
  if (!secret) return false;
  const timestamp = (headers.get("x-webhook-timestamp") || headers.get("x-publisher-timestamp") || "").trim();
  const nonce = readWebhookNonce(headers);
  const signature = (headers.get("x-webhook-signature") || headers.get("x-publisher-signature") || "").trim();
  if (!timestamp || !nonce || !signature || nonce.length > 200) return false;

  const timestampMs = Number(timestamp);
  const now = Date.now();
  if (!Number.isFinite(timestampMs) || Math.abs(now - timestampMs) > maxSkewMs) return false;

  purgeExpiredNonces(now);
  const nonceKey = `${scope}:${nonce}`;
  if (seenNonces.has(nonceKey)) return false;

  const expected = signWebhookBody({ secret, timestamp, nonce, body });
  if (!safeEqual(signature, expected)) return false;

  seenNonces.set(nonceKey, now + maxSkewMs);
  return true;
}

export function verifyStaticWebhookSecret(headers: Headers, expectedSecret: string): boolean {
  if (!expectedSecret) return false;
  const auth = headers.get("authorization") || "";
  const bearer = auth.replace(/^Bearer\s+/i, "").trim();
  const headerSecret = (headers.get("x-publisher-secret") || headers.get("x-webhook-secret") || "").trim();
  return safeEqual(bearer, expectedSecret) || safeEqual(headerSecret, expectedSecret);
}
