import { supabase } from "@/lib/supabaseClient";
import { normalizeDriveMimeType } from "@/lib/drive-policy";
import { MAX_PLAYBACK_VIDEO_FILE_SIZE, PLAYBACK_VIDEO_MIME_TYPES } from "@/lib/media-playback-policy";

export interface PlaybackUploadResult {
  playbackUrl: string;
  playbackStorageKey: string;
  mimeType: string;
  size: number;
}

interface PlaybackUploadTarget {
  bucket: string;
  storageKey: string;
  token: string;
  playbackUrl: string;
  mimeType: string;
  size: number;
}

const PLAYBACK_AUTH_TIMEOUT_MS = 5_000;

async function getAccessTokenFromCurrentSession(): Promise<string | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const result = await Promise.race([
    supabase.auth.getSession(),
    new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => resolve("timeout"), PLAYBACK_AUTH_TIMEOUT_MS);
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
  if (result === "timeout") {
    throw new Error("Playback auth check timed out. The original video uploaded fine; playback optimization can be retried.");
  }
  const { data } = result;
  return data.session?.access_token;
}

export function canUploadPlaybackCopy(file: File, mimeType = normalizeDriveMimeType(file.type, file.name)): boolean {
  return PLAYBACK_VIDEO_MIME_TYPES.includes(mimeType as typeof PLAYBACK_VIDEO_MIME_TYPES[number])
    && file.size > 0
    && file.size <= MAX_PLAYBACK_VIDEO_FILE_SIZE;
}

// storage-js uploadToSignedUrl (2.99.x) exposes neither an AbortSignal on its
// FileOptions nor upload-progress events, so it cannot use the Drive path's
// progress watchdog and, left unbounded, hangs forever on a dead/slow uplink
// (the "video upload takes forever" symptom). Bound it with a size-scaled
// budget instead of a flat ceiling: a base allowance plus time for the bytes at
// a slow-but-real uplink floor, so a genuinely slow upload still completes while
// a stalled one fails closed. The copy is best-effort (callers catch and keep
// the primary upload), so failing fast is strictly better than hanging.
const PLAYBACK_UPLOAD_BASE_MS = 30_000;
const PLAYBACK_UPLOAD_MIN_THROUGHPUT_BYTES_PER_SEC = 40 * 1024; // 40 KB/s ≈ 320 kbps
const PLAYBACK_TARGET_TIMEOUT_MS = 15_000;

export function playbackUploadBudgetMs(fileSize: number): number {
  const bytes = Number.isFinite(fileSize) && fileSize > 0 ? fileSize : 0;
  const transferMs = Math.ceil((bytes / PLAYBACK_UPLOAD_MIN_THROUGHPUT_BYTES_PER_SEC) * 1000);
  return PLAYBACK_UPLOAD_BASE_MS + transferMs;
}

async function getPlaybackUploadTarget(file: File, cardId?: string, workspaceId?: string): Promise<PlaybackUploadTarget> {
  const accessToken = await getAccessTokenFromCurrentSession();
  const headers: HeadersInit = { "Content-Type": "application/json" };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  if (workspaceId) headers["X-Workspace-Id"] = workspaceId;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PLAYBACK_TARGET_TIMEOUT_MS);
  let res: Response;
  const targetTimeoutMessage = "Playback upload target timed out. The original video uploaded fine; playback optimization can be retried.";
  const readText = async (): Promise<string> => {
    try {
      return await res.text();
    } catch (err) {
      if (controller.signal.aborted) throw new Error(targetTimeoutMessage);
      throw err;
    } finally {
      clearTimeout(timer);
    }
  };
  const readJson = async (): Promise<unknown> => {
    try {
      return await res.json();
    } catch (err) {
      if (controller.signal.aborted) throw new Error(targetTimeoutMessage);
      throw err;
    } finally {
      clearTimeout(timer);
    }
  };
  try {
    res = await fetch("/api/media/playback-upload", {
      method: "POST",
      headers,
      body: JSON.stringify({
        fileName: file.name,
        mimeType: normalizeDriveMimeType(file.type, file.name),
        fileSize: file.size,
        cardId,
      }),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    if (controller.signal.aborted) {
      throw new Error(targetTimeoutMessage);
    }
    throw err;
  }

  if (!res.ok) {
    const detail = await readText().catch(() => "");
    throw new Error(`Playback upload target failed with HTTP ${res.status}${detail ? `: ${detail.slice(0, 160)}` : ""}`);
  }

  const data = await readJson() as Partial<PlaybackUploadTarget> & { error?: string };
  if (data.error) throw new Error(data.error);
  if (!data.bucket || !data.storageKey || !data.token || !data.playbackUrl) {
    throw new Error("Playback upload target response was incomplete");
  }

  return data as PlaybackUploadTarget;
}

export async function uploadVideoPlaybackCopy(file: File, cardId?: string, workspaceId?: string): Promise<PlaybackUploadResult> {
  const mimeType = normalizeDriveMimeType(file.type, file.name);
  if (!PLAYBACK_VIDEO_MIME_TYPES.includes(mimeType as typeof PLAYBACK_VIDEO_MIME_TYPES[number])) {
    throw new Error("Playback copy is only supported for supported video files");
  }
  if (file.size > MAX_PLAYBACK_VIDEO_FILE_SIZE) {
    throw new Error(`Playback copy exceeds ${MAX_PLAYBACK_VIDEO_FILE_SIZE / (1024 * 1024)}MB limit`);
  }

  const target = await getPlaybackUploadTarget(file, cardId, workspaceId);

  // Fail closed instead of hanging: uploadToSignedUrl cannot be aborted in this
  // storage-js version, so race it against a size-scaled budget. The orphaned
  // request (if any) is harmless — the copy uses upsert:true and is best-effort.
  const TIMED_OUT = Symbol("playback-upload-timeout");
  let timer: ReturnType<typeof setTimeout> | undefined;
  const outcome = await Promise.race([
    supabase.storage
      .from(target.bucket)
      .uploadToSignedUrl(target.storageKey, target.token, file, {
        contentType: target.mimeType,
        upsert: true,
      }),
    new Promise<typeof TIMED_OUT>((resolve) => {
      timer = setTimeout(() => resolve(TIMED_OUT), playbackUploadBudgetMs(file.size));
    }),
  ]).finally(() => { if (timer) clearTimeout(timer); });

  if (outcome === TIMED_OUT) {
    throw new Error("Playback copy timed out. The original video uploaded fine; the fast-play copy can be retried.");
  }
  if (outcome.error) {
    throw new Error(`Playback upload failed: ${outcome.error.message}`);
  }

  return {
    playbackUrl: target.playbackUrl,
    playbackStorageKey: target.storageKey,
    mimeType: target.mimeType,
    size: target.size,
  };
}
