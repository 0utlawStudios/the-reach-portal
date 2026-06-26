import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { requireBearerTeamRole } from "@/lib/auth/require";
import { ALLOWED_DRIVE_UPLOAD_ROLES, normalizeDriveMimeType } from "@/lib/drive-policy";
import { MAX_PLAYBACK_VIDEO_FILE_SIZE, PLAYBACK_VIDEO_MIME_TYPES } from "@/lib/media-playback-policy";
import { enforcePlaybackBudget } from "@/lib/media-playback-budget";
import { consume, getClientIp } from "@/lib/rate-limit";
import {
  appRateLimitError,
  sanitizedDriveErrorDetail,
  sanitizeUnknownUploadError,
  statusForSanitizedDriveError,
} from "@/lib/drive-errors";
import { withStorageControlTimeout } from "@/lib/storage-upload-timeout";
import { scheduleUploadFailureAlert } from "@/app/api/drive/upload-alert-scheduler";

export const maxDuration = 10;
export const dynamic = "force-dynamic";

const BUCKET = "media-playback";
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

function extensionFor(mimeType: string): string {
  if (mimeType === "video/webm") return "webm";
  if (mimeType === "video/quicktime") return "mov";
  if (mimeType === "video/x-m4v") return "m4v";
  return "mp4";
}

const PLAYBACK_BUCKET_OPTIONS = {
  public: false,
  fileSizeLimit: MAX_PLAYBACK_VIDEO_FILE_SIZE,
  allowedMimeTypes: [...PLAYBACK_VIDEO_MIME_TYPES],
};

async function ensurePlaybackBucket(admin: SupabaseClient): Promise<void> {
  const existing = await withStorageControlTimeout(
    admin.storage.getBucket(BUCKET),
    "Playback bucket lookup",
  );
  if (!existing.error) {
    const current = existing.data as typeof existing.data & {
      file_size_limit?: number | string | null;
      allowed_mime_types?: string[] | null;
    };
    const currentLimit = current.file_size_limit == null ? null : Number(current.file_size_limit);
    const currentMimes = new Set(current.allowed_mime_types || []);
    const hasMimePolicy = PLAYBACK_VIDEO_MIME_TYPES.every((mime) => currentMimes.has(mime));
    if (!current.public && currentLimit === MAX_PLAYBACK_VIDEO_FILE_SIZE && hasMimePolicy) return;

    const updated = await withStorageControlTimeout(
      admin.storage.updateBucket(BUCKET, PLAYBACK_BUCKET_OPTIONS),
      "Playback bucket policy update",
    );
    if (updated.error) {
      throw new Error(`Playback bucket unavailable: ${updated.error.message}`);
    }
    return;
  }

  const created = await withStorageControlTimeout(
    admin.storage.createBucket(BUCKET, PLAYBACK_BUCKET_OPTIONS),
    "Playback bucket creation",
  );

  if (created.error && !/already exists/i.test(created.error.message)) {
    throw new Error(`Playback bucket unavailable: ${created.error.message}`);
  }
}

export async function POST(request: NextRequest) {
  let authContext: { user: { id: string }; email: string; role: string; workspaceId: string } | null = null;
  let fileName = "";
  let mimeType = "application/octet-stream";
  let fileSize = 0;
  let cardId = "pending";
  try {
    const auth = await requireBearerTeamRole(request, ALLOWED_DRIVE_UPLOAD_ROLES);
    if (auth instanceof NextResponse) return auth;
    authContext = auth;

    const rlKey = `user:${auth.user.id}|ip:${getClientIp(request)}`;
    const rl = await consume("media-playback-upload:create", rlKey, 60, 60, { onError: "deny" });
    if (!rl.allowed) {
      return NextResponse.json(appRateLimitError(rl.resetAt), { status: 429 });
    }

    const body = await request.json() as PlaybackUploadRequest;
    fileName = typeof body.fileName === "string" && body.fileName.trim()
      ? body.fileName.trim()
      : "video";
    mimeType = normalizeDriveMimeType(body.mimeType, fileName);
    fileSize = Number(body.fileSize);
    cardId = typeof body.cardId === "string" && body.cardId.trim()
      ? safeSegment(body.cardId.trim())
      : "pending";

    if (!PLAYBACK_VIDEO_MIME_TYPES.includes(mimeType as typeof PLAYBACK_VIDEO_MIME_TYPES[number])) {
      return NextResponse.json({ error: "Playback uploads must be video files" }, { status: 415 });
    }
    if (!Number.isFinite(fileSize) || fileSize <= 0) {
      return NextResponse.json({ error: "Missing or invalid fileSize" }, { status: 400 });
    }
    if (fileSize > MAX_PLAYBACK_VIDEO_FILE_SIZE) {
      return NextResponse.json(
        { error: `File exceeds ${MAX_PLAYBACK_VIDEO_FILE_SIZE / (1024 * 1024)}MB playback limit.` },
        { status: 413 },
      );
    }

    const admin = createAdminClient();
    await ensurePlaybackBucket(admin);

    // Keep the shared 1 GB free-tier Storage pool from overflowing: evict the oldest
    // (least-recently-played) playback copies before reserving room for this one. Best-
    // effort and fail-open — a budget hiccup must never block the upload itself.
    try {
      const budget = await enforcePlaybackBudget(admin, fileSize);
      if (budget.evicted > 0) {
        console.log(`[media/playback-upload] evicted ${budget.evicted} playback copies (${(budget.freedBytes / (1024 * 1024)).toFixed(0)}MB freed) to stay under the free-tier budget`);
      }
    } catch (budgetErr) {
      console.error("[media/playback-upload] budget enforcement skipped:", budgetErr instanceof Error ? budgetErr.message : budgetErr);
    }

    const ext = extensionFor(mimeType);
    const baseName = safeSegment(fileName.replace(/\.[^.]+$/, ""));
    const storageKey = `${auth.workspaceId}/${cardId}/${randomUUID()}-${baseName}.${ext}`;
    const { data, error } = await withStorageControlTimeout(
      admin.storage.from(BUCKET).createSignedUploadUrl(storageKey),
      "Playback signed upload URL creation",
    );
    if (error || !data?.token) {
      throw new Error(error?.message || "Failed to create playback upload URL");
    }

    const playbackUrl = `/api/media/playback?key=${encodeURIComponent(storageKey)}`;

    return NextResponse.json({
      bucket: BUCKET,
      storageKey,
      token: data.token,
      playbackUrl,
      mimeType,
      size: fileSize,
    });
  } catch (err: unknown) {
    const sanitized = sanitizeUnknownUploadError(err);
    const detail = sanitizedDriveErrorDetail(sanitized, statusForSanitizedDriveError(sanitized));
    console.error("[media/playback-upload]", detail);
    if (authContext) {
      scheduleUploadFailureAlert("media/playback-upload", {
        source: "server",
        phase: "playback_upload_target",
        route: "/api/media/playback-upload",
        uploadPath: fileSize >= 4 * 1024 * 1024 ? "resumable" : "proxy",
        workspaceId: authContext.workspaceId,
        userId: authContext.user.id,
        userEmail: authContext.email,
        userRole: authContext.role,
        folder: "media-playback",
        cardId,
        fileName,
        mimeType,
        fileSize,
        errorMessage: sanitized.error,
        errorStatus: statusForSanitizedDriveError(sanitized),
        errorDetail: detail,
        userAgent: request.headers.get("user-agent"),
        ip: getClientIp(request),
        requestUrl: request.url,
      });
    }
    return NextResponse.json({ error: "Failed to prepare playback upload" }, { status: 500 });
  }
}
