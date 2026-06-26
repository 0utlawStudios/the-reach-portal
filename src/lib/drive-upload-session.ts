import { createHmac, timingSafeEqual } from "node:crypto";
import type { DriveFolderName } from "@/lib/drive-policy";

// A resumable upload of the 500 MB ceiling on a slow uplink (~1 Mbps ≈ 67 min, worse
// on hotel/mobile wifi) must not outlive its session token mid-stream — that expiry
// surfaced as the chunk route's 403, which used to be mislabeled "Storage rejected the
// upload." 12h comfortably covers the largest file on a pathological connection. The
// token is tightly scoped (one Google session URI + one workspace/user/folder/size), so
// the longer lifetime carries negligible risk. Google resumable sessions live ~1 week.
const UPLOAD_SESSION_TOKEN_TTL_MS = 12 * 60 * 60 * 1000;

// Signed fields are limited to values that CANNOT diverge between sign-time and
// verify-time: workspaceId/userId come from the server auth context, uploadUri is
// validated + URL-normalized identically on both sides, folder is a fixed enum, and
// fileSize is an integer from the Content-Range total. fileName and mimeType are
// deliberately NOT signed: they travel as the X-File-Name / Content-Type request
// headers, and a non-ASCII filename (emoji, accents) mangles in transit so the HMAC
// would never match — a self-inflicted, mislabeled 403. They add no security here
// because the token is already bound to one specific Google session URI.
type UploadSessionParts = {
  uploadUri: string;
  workspaceId: string;
  userId: string;
  folder: DriveFolderName;
  fileSize: number;
};

function uploadSessionSecret(): string {
  return process.env.DRIVE_UPLOAD_SESSION_SECRET ||
    (process.env.NODE_ENV === "production" ? "" : process.env.DRIVE_STREAM_TOKEN_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || "");
}

function uploadSessionPayload(parts: UploadSessionParts & { expiresAt: number }): string {
  return [
    parts.uploadUri,
    parts.workspaceId,
    parts.userId,
    parts.folder,
    String(parts.fileSize),
    String(parts.expiresAt),
  ].join("\n");
}

export function signDriveUploadSession(parts: UploadSessionParts, expiresAt = Date.now() + UPLOAD_SESSION_TOKEN_TTL_MS): string {
  const secret = uploadSessionSecret();
  if (!secret) throw new Error("Upload session signing secret is not configured");
  const signature = createHmac("sha256", secret)
    .update(uploadSessionPayload({ ...parts, expiresAt }))
    .digest("base64url");
  return `v1.${expiresAt}.${signature}`;
}

export function verifyDriveUploadSessionToken(token: string | null, parts: UploadSessionParts): boolean {
  if (!token) return false;
  const secret = uploadSessionSecret();
  if (!secret) return false;
  try {
    const [version, expiresAtRaw, signature] = token.split(".");
    if (version !== "v1" || !expiresAtRaw || !signature) return false;
    const expiresAt = Number(expiresAtRaw);
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return false;
    const expected = createHmac("sha256", secret)
      .update(uploadSessionPayload({ ...parts, expiresAt }))
      .digest("base64url");
    const a = Buffer.from(expected);
    const b = Buffer.from(signature);
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
