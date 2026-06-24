import { createHmac, timingSafeEqual } from "node:crypto";
import type { DriveFolderName } from "@/lib/drive-policy";

const UPLOAD_SESSION_TOKEN_TTL_MS = 60 * 60 * 1000;

type UploadSessionParts = {
  uploadUri: string;
  workspaceId: string;
  userId: string;
  folder: DriveFolderName;
  fileName: string;
  mimeType: string;
  fileSize: number;
};

function uploadSessionSecret(): string {
  return process.env.DRIVE_STREAM_TOKEN_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
}

function uploadSessionPayload(parts: UploadSessionParts & { expiresAt: number }): string {
  return [
    parts.uploadUri,
    parts.workspaceId,
    parts.userId,
    parts.folder,
    parts.fileName,
    parts.mimeType,
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
