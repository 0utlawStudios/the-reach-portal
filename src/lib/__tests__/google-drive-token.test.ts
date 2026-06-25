import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getPublishStreamUrl, getStreamUrl, signDriveStreamToken, verifyDriveStreamToken } from "@/lib/google-drive";

const OLD_ENV = process.env.DRIVE_STREAM_SIGNING_SECRET;
const OLD_SITE_URL = process.env.NEXT_PUBLIC_SITE_URL;
const OLD_VERCEL_URL = process.env.VERCEL_URL;
const FILE_ID = "abcdefghijklmnopqrst";
const WORKSPACE_ID = "00000000-0000-0000-0000-000000000001";

beforeEach(() => {
  process.env.DRIVE_STREAM_SIGNING_SECRET = "test-drive-stream-secret";
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-06-24T00:00:00.000Z"));
});

afterEach(() => {
  if (OLD_ENV === undefined) delete process.env.DRIVE_STREAM_SIGNING_SECRET;
  else process.env.DRIVE_STREAM_SIGNING_SECRET = OLD_ENV;
  if (OLD_SITE_URL === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
  else process.env.NEXT_PUBLIC_SITE_URL = OLD_SITE_URL;
  if (OLD_VERCEL_URL === undefined) delete process.env.VERCEL_URL;
  else process.env.VERCEL_URL = OLD_VERCEL_URL;
  vi.useRealTimers();
});

describe("Drive stream tokens", () => {
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
