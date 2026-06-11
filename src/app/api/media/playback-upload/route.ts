import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { requireBearerTeamRole } from "@/lib/auth/require";
import { ALLOWED_DRIVE_ROLES, MAX_DRIVE_MEDIA_FILE_SIZE, normalizeDriveMimeType } from "@/lib/drive-policy";
import { consume, getClientIp } from "@/lib/rate-limit";
import { appRateLimitError } from "@/lib/drive-errors";

export const maxDuration = 10;
export const dynamic = "force-dynamic";

const BUCKET = "media-playback";
const VIDEO_MIME_TYPES = ["video/mp4", "video/x-m4v", "video/quicktime", "video/webm"];
type PlaybackUploadRequest = {
  fileName?: unknown;
  mimeType?: unknown;
  fileSize?: unknown;
  cardId?: unknown;
};

function assertEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

function createAdminClient() {
  return createClient(
    assertEnv("NEXT_PUBLIC_SUPABASE_URL"),
    assertEnv("SUPABASE_SERVICE_ROLE_KEY"),
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    },
  );
}

function safeSegment(value: string): string {
  return value
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80) || "video";
}

function extensionFor(fileName: string, mimeType: string): string {
  const ext = fileName.includes(".") ? fileName.split(".").pop()?.toLowerCase() || "" : "";
  if (/^[a-z0-9]{2,5}$/.test(ext)) return ext;
  if (mimeType === "video/webm") return "webm";
  if (mimeType === "video/quicktime") return "mov";
  if (mimeType === "video/x-m4v") return "m4v";
  return "mp4";
}

async function ensurePlaybackBucket(admin: SupabaseClient): Promise<void> {
  const existing = await admin.storage.getBucket(BUCKET);
  if (!existing.error) {
    if (existing.data?.public) return;

    const updated = await admin.storage.updateBucket(BUCKET, { public: true });
    if (updated.error) {
      throw new Error(`Playback bucket unavailable: ${updated.error.message}`);
    }
    return;
  }

  const created = await admin.storage.createBucket(BUCKET, { public: true });

  if (created.error && !/already exists/i.test(created.error.message)) {
    throw new Error(`Playback bucket unavailable: ${created.error.message}`);
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireBearerTeamRole(request, ALLOWED_DRIVE_ROLES);
    if (auth instanceof NextResponse) return auth;

    const rlKey = `user:${auth.user.id}|ip:${getClientIp(request)}`;
    const rl = await consume("media-playback-upload:create", rlKey, 60, 60);
    if (!rl.allowed) {
      return NextResponse.json(appRateLimitError(rl.resetAt), { status: 429 });
    }

    const body = await request.json() as PlaybackUploadRequest;
    const fileName = typeof body.fileName === "string" && body.fileName.trim()
      ? body.fileName.trim()
      : "video";
    const mimeType = normalizeDriveMimeType(body.mimeType, fileName);
    const fileSize = Number(body.fileSize);
    const cardId = typeof body.cardId === "string" && body.cardId.trim()
      ? safeSegment(body.cardId.trim())
      : "pending";

    if (!VIDEO_MIME_TYPES.includes(mimeType)) {
      return NextResponse.json({ error: "Playback uploads must be video files" }, { status: 415 });
    }
    if (!Number.isFinite(fileSize) || fileSize <= 0) {
      return NextResponse.json({ error: "Missing or invalid fileSize" }, { status: 400 });
    }
    if (fileSize > MAX_DRIVE_MEDIA_FILE_SIZE) {
      return NextResponse.json(
        { error: `File exceeds ${MAX_DRIVE_MEDIA_FILE_SIZE / (1024 * 1024)}MB limit.` },
        { status: 413 },
      );
    }

    const admin = createAdminClient();
    await ensurePlaybackBucket(admin);

    const ext = extensionFor(fileName, mimeType);
    const baseName = safeSegment(fileName.replace(/\.[^.]+$/, ""));
    const storageKey = `${auth.workspaceId}/${cardId}/${randomUUID()}-${baseName}.${ext}`;
    const { data, error } = await admin.storage.from(BUCKET).createSignedUploadUrl(storageKey);
    if (error || !data?.token) {
      throw new Error(error?.message || "Failed to create playback upload URL");
    }

    const publicUrl = admin.storage.from(BUCKET).getPublicUrl(storageKey).data.publicUrl;

    return NextResponse.json({
      bucket: BUCKET,
      storageKey,
      token: data.token,
      publicUrl,
      mimeType,
      size: fileSize,
    });
  } catch (err: unknown) {
    console.error("[media/playback-upload]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Failed to prepare playback upload" }, { status: 500 });
  }
}
