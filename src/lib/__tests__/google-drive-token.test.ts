import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getPublishStreamUrl, getStreamUrl, signDriveStreamToken, signStableThumbToken, stableThumbTokenExpiry, verifyDriveStreamToken } from "@/lib/google-drive";

const OLD_ENV = { ...process.env };
const FILE_ID = "abcdefghijklmnopqrst";
const WORKSPACE_ID = "00000000-0000-0000-0000-000000000001";

function setNodeEnv(value: "production" | "development" | "test") {
  Object.defineProperty(process.env, "NODE_ENV", { value, configurable: true, enumerable: true, writable: true });
}

beforeEach(() => {
  process.env.DRIVE_STREAM_SIGNING_SECRET = "test-drive-stream-secret";
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-06-24T00:00:00.000Z"));
});

afterEach(() => {
  process.env = { ...OLD_ENV };
  vi.useRealTimers();
});

describe("Drive stream tokens", () => {
  it("fails closed in production without a dedicated Drive stream signing secret", () => {
    setNodeEnv("production");
    delete process.env.DRIVE_STREAM_SIGNING_SECRET;
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-secret";
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON = "service-account-json";

    expect(() => signDriveStreamToken(FILE_ID, WORKSPACE_ID)).toThrow("Drive stream signing secret is not configured");
  });

  it("signs Drive stream tokens with workspace and expiry claims", () => {
    const expiresAt = Date.now() + 60_000;
    const token = signDriveStreamToken(FILE_ID, WORKSPACE_ID, expiresAt, "publish");

    expect(verifyDriveStreamToken(FILE_ID, token)).toEqual({ workspaceId: WORKSPACE_ID, expiresAt, purpose: "publish" });
    expect(verifyDriveStreamToken("other-file-id-abcdefghijkl", token)).toBeNull();
  });

  it("rejects expired and legacy fileId-only stream tokens", () => {
    const expired = signDriveStreamToken(FILE_ID, WORKSPACE_ID, Date.now() - 1);
    const legacy = createHmac("sha256", "test-drive-stream-secret")
      .update(FILE_ID)
      .digest("base64url");

    expect(verifyDriveStreamToken(FILE_ID, expired)).toBeNull();
    expect(verifyDriveStreamToken(FILE_ID, legacy)).toBeNull();
  });

  it("classifies copied legacy private app tokens separately from long-lived publish tokens", () => {
    const privateExpiry = Date.now() + 24 * 60 * 60 * 1000;
    const publishExpiry = Date.now() + 365 * 24 * 60 * 60 * 1000;
    const privateSig = createHmac("sha256", "test-drive-stream-secret")
      .update(`${FILE_ID}.${WORKSPACE_ID}.${privateExpiry}`)
      .digest("base64url");
    const publishSig = createHmac("sha256", "test-drive-stream-secret")
      .update(`${FILE_ID}.${WORKSPACE_ID}.${publishExpiry}`)
      .digest("base64url");

    expect(verifyDriveStreamToken(FILE_ID, `v1.${privateExpiry}.${WORKSPACE_ID}.${privateSig}`))
      .toEqual({ workspaceId: WORKSPACE_ID, expiresAt: privateExpiry, purpose: "private" });
    expect(verifyDriveStreamToken(FILE_ID, `v1.${publishExpiry}.${WORKSPACE_ID}.${publishSig}`))
      .toEqual({ workspaceId: WORKSPACE_ID, expiresAt: publishExpiry, purpose: "publish" });
  });

  it("signs a stable, workspace-bound thumbnail capability that verifies as purpose thumb", () => {
    const token = signStableThumbToken(FILE_ID, WORKSPACE_ID);
    const claims = verifyDriveStreamToken(FILE_ID, token);
    expect(claims).toEqual({ workspaceId: WORKSPACE_ID, expiresAt: stableThumbTokenExpiry(), purpose: "thumb" });
    // Bound to this exact file — a thumb token cannot be moved to another file id.
    expect(verifyDriveStreamToken("other-file-id-abcdefghijkl", token)).toBeNull();
  });

  it("produces a BYTE-IDENTICAL thumbnail token across signs (so the URL is edge-cacheable)", () => {
    const first = signStableThumbToken(FILE_ID, WORKSPACE_ID);
    // Advance time within the same 30-day bucket — the token must not drift.
    vi.advanceTimersByTime(6 * 24 * 60 * 60 * 1000);
    const second = signStableThumbToken(FILE_ID, WORKSPACE_ID);
    expect(second).toBe(first);
    // A different workspace gets a different token (no cross-workspace URL collision).
    expect(signStableThumbToken(FILE_ID, "00000000-0000-0000-0000-0000000000ff")).not.toBe(first);
  });

  it("keeps the thumbnail expiry bounded — future, never permanent, bucket-aligned", () => {
    const BUCKET = 30 * 24 * 60 * 60 * 1000;
    const expiry = stableThumbTokenExpiry();
    expect(expiry % BUCKET).toBe(0);
    expect(expiry - Date.now()).toBeGreaterThan(BUCKET); // at least ~30 days out
    expect(expiry - Date.now()).toBeLessThanOrEqual(2 * BUCKET); // never more than ~60 days
    // Next bucket rolls the token forward (monthly rotation), not frozen forever.
    expect(stableThumbTokenExpiry(Date.now() + 2 * BUCKET)).toBeGreaterThan(expiry);
  });

  it("rejects a thumbnail token whose signature was tampered", () => {
    const token = signStableThumbToken(FILE_ID, WORKSPACE_ID);
    const tampered = `${token.slice(0, -2)}xy`;
    expect(verifyDriveStreamToken(FILE_ID, tampered)).toBeNull();
  });

  it("rejects an expired thumbnail token", () => {
    const token = signStableThumbToken(FILE_ID, WORKSPACE_ID);
    // Jump past the bucketed expiry (~2 months) — verify must fail closed.
    vi.advanceTimersByTime(70 * 24 * 60 * 60 * 1000);
    expect(verifyDriveStreamToken(FILE_ID, token)).toBeNull();
  });

  it("returns same-origin tokenless private app URLs and signed publish URLs", () => {
    delete process.env.NEXT_PUBLIC_SITE_URL;
    delete process.env.VERCEL_URL;

    expect(getStreamUrl(FILE_ID, WORKSPACE_ID)).toBe(`/api/drive/stream?id=${FILE_ID}`);
    expect(getStreamUrl(FILE_ID, WORKSPACE_ID)).not.toContain("token=");

    process.env.VERCEL_URL = "reach-preview.vercel.app";
    expect(getStreamUrl(FILE_ID, WORKSPACE_ID)).toBe(`/api/drive/stream?id=${FILE_ID}`);
    expect(getStreamUrl(FILE_ID, WORKSPACE_ID)).not.toContain("token=");

    process.env.NEXT_PUBLIC_SITE_URL = "https://thereach.ten80ten.com/";
    expect(getPublishStreamUrl(FILE_ID, WORKSPACE_ID)).toMatch(/^https:\/\/thereach\.ten80ten\.com\/api\/drive\/stream\?/);
    expect(getPublishStreamUrl(FILE_ID, WORKSPACE_ID)).toContain("token=");
    expect(verifyDriveStreamToken(FILE_ID, new URL(getPublishStreamUrl(FILE_ID, WORKSPACE_ID)).searchParams.get("token"))?.purpose)
      .toBe("publish");
  });
});
