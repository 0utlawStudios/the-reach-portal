/**
 * Client-side Google Drive upload — two paths based on file size.
 *
 * Small files (< 4 MB): proxy path
 *   Client → /api/drive/proxy-upload (FormData) → Google Drive → returns fileId + URL
 *   One round-trip, proven, fast for thumbnails and small images.
 *
 * Large files (≥ 4 MB): resumable path (bypasses Vercel's 4.5 MB body limit)
 *   1. Client → /api/drive/upload (JSON metadata) → returns uploadUri
 *   2. Client → /api/drive/upload-chunk (2 MB chunks) → Google resumable session
 *   3. Client → /api/drive/finalize (JSON fileId) → sets permissions, returns URL
 *
 * The uploadUri is a pre-authenticated Google URL minted server-side. Browsers
 * cannot reliably PUT to that URL because Google does not return CORS headers
 * for these service-account sessions, so bytes go through a same-origin chunk
 * proxy. Each chunk is below Vercel's request body limit.
 *
 * Guarantees:
 * - Never returns a blob: URL
 * - 3-attempt exponential backoff on transient failures
 * - Throws on permanent failure (caller must handle)
 * - 413 is treated as permanent (not retried)
 */

import {
  DRIVE_RESUMABLE_CHUNK_SIZE,
  isAllowedDriveUploadForFolder,
  MAX_DRIVE_MEDIA_FILE_SIZE,
  normalizeDriveMimeType,
} from "@/lib/drive-policy";
import {
  type DriveErrorReason,
  type SanitizedDriveError,
  sanitizeGoogleDriveError,
  sanitizeUnknownUploadError,
} from "@/lib/drive-errors";
import { supabase } from "@/lib/supabaseClient";

export interface DriveUploadResult {
  fileId: string;
  url: string;
  publishUrl?: string;
  driveProxyUrl?: string;
  mimeType?: string;
  size?: number;
}

export type ProgressCallback = (percent: number) => void;

export interface UploadFailureReport {
  phase?: string;
  route?: string;
  uploadPath?: "proxy" | "resumable" | "unknown";
  workspaceId?: string;
  cardId?: string;
  postTitle?: string;
  folder?: string;
  fileName?: string;
  mimeType?: string;
  fileSize?: number;
  batchTotal?: number;
  batchFailed?: number;
  errorMessage: string;
  errorStatus?: number;
  errorDetail?: string;
}

type ResumableUploadSession = {
  uploadUri: string;
  uploadToken: string;
};

// Interactive-friendly backoff. The old [2000, 8000, 32000] meant a single
// transient hiccup cost up to 42s of dead waiting (and the proxy path re-sent
// the whole file each time). Worst case is now ~11s.
const RETRY_DELAYS = process.env.NODE_ENV === "test" ? [1, 3, 7] : [1000, 3000, 7000];

// A large resumable upload is expensive to repeat, so it gets a single gentle
// retry rather than the full ladder. A retry starts a fresh Google session.
const PUT_RETRY_DELAYS = process.env.NODE_ENV === "test" ? [1] : [3000];
const UPLOAD_FAILURE_REPORT_TIMEOUT_MS = 3_000;

// Upload liveness is governed by TWO progress-aware timers, never a fixed
// whole-request ceiling:
//
//   1. STALL_TIMEOUT_MS — the no-progress watchdog. Re-armed on every upload
//      progress event, so it fires ONLY when bytes genuinely stop moving. A
//      slow-but-moving upload is never killed. This is what kills the literal
//      "upload hangs with no end" symptom (XMLHttpRequest has no default
//      timeout, so without a watchdog a dead connection hangs forever).
//   2. DIRECT_RESPONSE_WAIT_MS — armed once every byte is sent, bounding how
//      long we wait for the server's response (the send watchdog can't help
//      here: no more upload-progress events arrive after the last byte).
//
// We deliberately do NOT set xhr.timeout. A fixed whole-request ceiling fires
// ontimeout even while bytes are still flowing. On 2026-06-24 a 5.55 MB JPEG on
// a slow uplink hit the old 120s xhr.timeout and failed "Upload timed out."
// although the server never errored and the upload was still progressing — the
// byte-transfer time counts against the client clock but NOT Vercel's function
// maxDuration (the body streams in at the platform layer before the function
// runs), so the server logged nothing and only the client gave up. The two
// timers above catch real stalls without punishing slow connections.
const STALL_TIMEOUT_MS = 30000;
const DIRECT_RESPONSE_WAIT_MS = 60000;
const AUTH_SESSION_TIMEOUT_MS = 10000;

// Files at or above this threshold upload directly to storage (client PUTs bytes
// straight to Google; the server only mints the session + finalizes). Below it,
// the small-file proxy path is used — a SINGLE round-trip per file with a 60s
// server budget and a stall watchdog.
//
// Kept at 4 MB (just under Vercel's 4.5 MB request-body limit). An earlier change
// lowered this to 1 MB to "help slow connections", but that pushed ordinary
// photos onto the direct path, whose per-file session+finalize fetches timed out
// under a large batch — a real 26-file upload failed with "Upload timed out".
// The slow-connection case is already handled by the stall watchdog + gentle
// retries on the proxy path, so the proxy is the right home for anything < 4 MB.
const RESUMABLE_THRESHOLD = 4 * 1024 * 1024; // 4 MB

export class DriveUploadError extends Error {
  status?: number;
  reason: DriveErrorReason;
  retryable: boolean;
  retryAfterMs?: number;

  constructor(message: string, opts: {
    status?: number;
    reason?: DriveErrorReason;
    retryable?: boolean;
    retryAfterMs?: number;
  } = {}) {
    super(message);
    this.name = "DriveUploadError";
    this.status = opts.status;
    this.reason = opts.reason || "unknown";
    this.retryable = opts.retryable ?? false;
    this.retryAfterMs = opts.retryAfterMs;
  }
}

export function retryDelayWithJitter(baseDelayMs: number, jitter = Math.random()): number {
  return baseDelayMs + Math.floor(Math.max(0, Math.min(1, jitter)) * 1000);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function toDriveUploadError(payload: SanitizedDriveError, status?: number): DriveUploadError {
  return new DriveUploadError(payload.error, {
    status,
    reason: payload.errorReason,
    retryable: payload.retryable,
    retryAfterMs: payload.retryAfterMs,
  });
}

function errorFromPayload(status: number, payload: unknown): DriveUploadError {
  if (isRecord(payload) && typeof payload.errorReason === "string") {
    return toDriveUploadError({
      error: typeof payload.error === "string" ? payload.error : "Upload failed. Please try again.",
      errorReason: payload.errorReason as DriveErrorReason,
      retryable: payload.retryable === true,
      retryAfterMs: typeof payload.retryAfterMs === "number" ? payload.retryAfterMs : undefined,
    }, status);
  }
  return toDriveUploadError(sanitizeGoogleDriveError(status, payload), status);
}

function maybePostSendNonRetryable(error: Error, fallbackStatus?: number): Error {
  if (!(error instanceof DriveUploadError)) return error;
  const status = error.status ?? fallbackStatus;
  const completionAmbiguous =
    typeof status === "number" && status >= 500 ||
    error.reason === "timeout" ||
    error.reason === "network" ||
    error.reason === "serverError";
  if (!completionAmbiguous || !error.retryable) return error;
  return new DriveUploadError(
    "The upload reached the server but failed while finishing. Check the media library before retrying to avoid duplicates.",
    {
      status,
      reason: error.reason,
      retryable: false,
    },
  );
}

type TimedFetchResponse = {
  res: Response;
  readText: () => Promise<string>;
  readJson: () => Promise<unknown>;
};

async function errorFromResponse(response: TimedFetchResponse): Promise<DriveUploadError> {
  const text = await response.readText();
  const res = response.res;
  return errorFromPayload(res.status, parseJson(text));
}

function isRetryableUploadError(error: Error): boolean {
  if (error instanceof DriveUploadError) return error.retryable;
  const sanitized = sanitizeUnknownUploadError(error);
  return sanitized.retryable;
}

async function withRetry<T>(fn: () => Promise<T>, label: string, delays: number[] = RETRY_DELAYS): Promise<T> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (!isRetryableUploadError(lastError)) {
        throw lastError;
      }
      if (attempt < delays.length) {
        const baseDelay = lastError instanceof DriveUploadError && lastError.retryAfterMs
          ? Math.max(delays[attempt], lastError.retryAfterMs)
          : delays[attempt];
        const delay = retryDelayWithJitter(baseDelay);
        console.warn(`[drive-upload] ${label} attempt ${attempt + 1} failed, retrying in ${delay}ms...`);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  throw lastError || new Error(`${label} failed after ${delays.length + 1} attempts`);
}

// Aborts an in-flight upload when no progress arrives for STALL_TIMEOUT_MS.
// kick() re-arms the timer on each progress event; clear() disarms it once the
// request settles. The caller wires these to the xhr events.
function makeStallWatchdog(xhr: XMLHttpRequest, onStall: () => void) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const clear = () => {
    if (timer) { clearTimeout(timer); timer = null; }
  };
  const kick = () => {
    clear();
    timer = setTimeout(() => {
      onStall();
      try { xhr.abort(); } catch { /* already settled */ }
    }, STALL_TIMEOUT_MS);
  };
  return { kick, clear };
}

// fetch() has no default timeout, so a slow or dead endpoint can leave the
// "finishing up" step hanging with no end — a card stuck below 100% forever.
// The AbortController bounds it; withRetry treats the resulting error as
// retryable, and the message stays honest for the user.
const FETCH_TIMEOUT_MS = 45000;
async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = FETCH_TIMEOUT_MS): Promise<TimedFetchResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const clearTimer = () => clearTimeout(timer);
  const readWithTimeout = async <T>(read: () => Promise<T>): Promise<T> => {
    try {
      return await read();
    } catch (err) {
      if (controller.signal.aborted) throw new Error("Upload timed out");
      throw err;
    } finally {
      clearTimer();
    }
  };
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    return {
      res,
      readText: () => readWithTimeout(() => res.text()),
      readJson: () => readWithTimeout(() => res.json()),
    };
  } catch (err) {
    clearTimer();
    if (controller.signal.aborted) throw new Error("Upload timed out");
    throw err;
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, error: Error): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(error), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function getAccessTokenFromCurrentSession(): Promise<string | undefined> {
  const { data } = await withTimeout(
    supabase.auth.getSession(),
    AUTH_SESSION_TIMEOUT_MS,
    new DriveUploadError("Upload authorization failed. Please sign in again.", {
      reason: "auth",
      retryable: false,
    }),
  );
  return data.session?.access_token;
}

// ─── Proxy path (< 4 MB) ───────────────────────────────────────────────────

async function uploadViaProxy(
  file: File,
  folder: string,
  cardId: string | undefined,
  workspaceId: string | undefined,
  onProgress: ProgressCallback | undefined
): Promise<DriveUploadResult> {
  return withRetry(async () => {
    // The proxy route requires a Bearer token (SEC-001 hardening). Attach the
    // caller's current session token, mirroring the resumable path's headers.
    onProgress?.(2);
    const accessToken = await getAccessTokenFromCurrentSession();
    onProgress?.(4);

    const mimeType = normalizeDriveMimeType(file.type, file.name);
    const formData = new FormData();
    formData.append("file", file);
    formData.append("folder", folder);
    formData.append("fileName", file.name);
    formData.append("mimeType", mimeType);
    if (cardId) formData.append("cardId", cardId);

    return new Promise<DriveUploadResult>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      let settled = false;
      // Track whether the browser finished sending every byte. If a network or
      // timeout error fires AFTER the full body was sent, the server may have
      // already created the Drive file but lost the response — auto-retrying
      // would silently create a DUPLICATE. So a post-send failure is reported
      // as non-retryable with an honest "check the library" message instead.
      let fullySent = false;
      let responseTimer: ReturnType<typeof setTimeout> | null = null;
      const clearResponseTimer = () => {
        if (responseTimer) { clearTimeout(responseTimer); responseTimer = null; }
      };
      const markFullySent = () => {
        if (fullySent) return;
        fullySent = true;
        watchdog.clear();
        armResponseTimer();
        onProgress?.(92);
      };
      // Once every byte is sent, upload-progress events stop and the stall
      // watchdog can no longer help, so bound the wait for the server response.
      // A post-send timeout is non-retryable: the server may have already
      // created the Drive file, so auto-retrying could DUPLICATE it.
      const armResponseTimer = () => {
        clearResponseTimer();
        responseTimer = setTimeout(() => fail(new DriveUploadError(
          "The upload reached the server but timed out waiting for a response. Check the media library before retrying.",
          { reason: "timeout", retryable: false },
        )), DIRECT_RESPONSE_WAIT_MS);
      };
      const fail = (err: Error) => { if (settled) return; settled = true; watchdog.clear(); clearResponseTimer(); reject(err); };
      const done = (value: DriveUploadResult) => { if (settled) return; settled = true; watchdog.clear(); clearResponseTimer(); resolve(value); };
      const watchdog = makeStallWatchdog(xhr, () => fail(new Error("Upload stalled (no progress for 30s)")));

      xhr.open("POST", "/api/drive/proxy-upload", true);
      if (accessToken) xhr.setRequestHeader("Authorization", `Bearer ${accessToken}`);
      if (workspaceId) xhr.setRequestHeader("X-Workspace-Id", workspaceId);

      xhr.upload.onprogress = (e) => {
        watchdog.kick();
        if (e.lengthComputable) {
          onProgress?.(Math.round((e.loaded / e.total) * 90));
          if (e.loaded >= e.total) {
            markFullySent();
          }
        }
      };
      xhr.upload.onload = markFullySent;

      xhr.onload = () => {
        watchdog.clear();
        onProgress?.(95);
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const data = JSON.parse(xhr.responseText);
            if (data.error) {
              const error = errorFromPayload(xhr.status || 500, data);
              fail(fullySent ? maybePostSendNonRetryable(error, xhr.status || 500) : error);
            } else {
              onProgress?.(100);
              done({
                fileId: data.fileId,
                url: data.url,
                publishUrl: data.publishUrl,
                driveProxyUrl: data.driveProxyUrl || data.url,
                mimeType: data.mimeType,
                size: data.size,
              });
            }
          } catch {
            fail(new Error("Invalid response from upload server"));
          }
        } else {
          let error: DriveUploadError;
          try {
            const data = JSON.parse(xhr.responseText);
            error = errorFromPayload(xhr.status, data);
          } catch {
            error = errorFromPayload(xhr.status, xhr.responseText);
          }
          fail(fullySent ? maybePostSendNonRetryable(error, xhr.status) : error);
        }
      };

      xhr.onerror = () => fail(new DriveUploadError(
        fullySent
          ? "The upload reached the server but the response was lost. Check the media library before retrying."
          : "Network error during upload.",
        { reason: "network", retryable: !fullySent },
      ));
      xhr.ontimeout = () => fail(new DriveUploadError(
        fullySent
          ? "The upload reached the server but timed out waiting for a response. Check the media library before retrying."
          : "Upload timed out.",
        { reason: "timeout", retryable: !fullySent },
      ));
      xhr.onabort = () => fail(fullySent
        ? new DriveUploadError(
          "The upload reached the server but the response was interrupted. Check the media library before retrying.",
          { reason: "network", retryable: false },
        )
        : new Error("Upload aborted"));
      watchdog.kick();
      onProgress?.(5);
      xhr.send(formData);
    });
  }, "Proxy upload");
}

// ─── Resumable path (≥ 4 MB) ──────────────────────────────────────────────

async function getAuthHeaders(workspaceId?: string): Promise<HeadersInit> {
  const accessToken = await getAccessTokenFromCurrentSession();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }
  if (workspaceId) headers["X-Workspace-Id"] = workspaceId;
  return headers;
}

async function getUploadSession(
  file: File,
  folder: string,
  cardId: string | undefined,
  workspaceId: string | undefined,
): Promise<ResumableUploadSession> {
  const headers = await getAuthHeaders(workspaceId);
  const res = await fetchWithTimeout("/api/drive/upload", {
    method: "POST",
    headers,
    body: JSON.stringify({
      fileName: file.name,
      mimeType: normalizeDriveMimeType(file.type, file.name),
      folder,
      cardId,
      fileSize: file.size,
    }),
  });

  if (!res.res.ok) {
    throw await errorFromResponse(res);
  }

	  const data = await res.readJson() as { uploadUri?: string; uploadToken?: string };
	  if (!data.uploadUri) throw new Error("No uploadUri returned from session endpoint");
	  if (!data.uploadToken) throw new Error("No upload token returned from session endpoint");
	  return { uploadUri: data.uploadUri, uploadToken: data.uploadToken };
}

async function uploadResumableChunk(
  file: File,
  session: ResumableUploadSession,
  folder: string,
  accessToken: string | undefined,
  workspaceId: string | undefined,
  start: number,
  end: number,
  onProgress: ProgressCallback | undefined
): Promise<{ done: boolean; fileId?: string }> {
  const mimeType = normalizeDriveMimeType(file.type, file.name);
  const chunk = file.slice(start, end + 1, mimeType);
  const total = file.size;
  return new Promise<{ done: boolean; fileId?: string }>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let settled = false;
    let fullySent = false;
    const isFinalChunk = end + 1 >= total;
    let responseTimer: ReturnType<typeof setTimeout> | null = null;
    const clearResponseTimer = () => {
      if (responseTimer) { clearTimeout(responseTimer); responseTimer = null; }
    };
    const postSendChunkError = (message: string, reason: DriveErrorReason, status?: number) => new DriveUploadError(message, {
      status,
      reason,
      retryable: !isFinalChunk,
    });
    const armResponseTimer = () => {
      clearResponseTimer();
      responseTimer = setTimeout(() => {
        fail(postSendChunkError(
          isFinalChunk
            ? "The upload reached storage but the final response was lost. Check the media library before retrying."
            : "Upload finished sending but storage did not respond",
          "timeout",
        ));
      }, DIRECT_RESPONSE_WAIT_MS);
    };
    const markFullySent = () => {
      if (fullySent) return;
      fullySent = true;
      watchdog.clear();
      armResponseTimer();
    };
    const fail = (err: Error) => { if (settled) return; settled = true; watchdog.clear(); clearResponseTimer(); reject(err); };
    const done = (value: { done: boolean; fileId?: string }) => { if (settled) return; settled = true; watchdog.clear(); clearResponseTimer(); resolve(value); };
    const watchdog = makeStallWatchdog(xhr, () => fail(new Error("Upload stalled (no progress for 30s)")));

    xhr.open("POST", "/api/drive/upload-chunk", true);
    xhr.setRequestHeader("Content-Type", mimeType);
    xhr.setRequestHeader("Content-Range", `bytes ${start}-${end}/${total}`);
	    xhr.setRequestHeader("X-Upload-Uri", session.uploadUri);
	    xhr.setRequestHeader("X-Upload-Token", session.uploadToken);
    xhr.setRequestHeader("X-File-Name", file.name);
    xhr.setRequestHeader("X-Drive-Folder", folder);
    if (accessToken) xhr.setRequestHeader("Authorization", `Bearer ${accessToken}`);
    if (workspaceId) xhr.setRequestHeader("X-Workspace-Id", workspaceId);

    xhr.upload.onprogress = (e) => {
      watchdog.kick();
      if (e.lengthComputable) {
        const loaded = Math.min(e.loaded, end - start + 1);
        onProgress?.(5 + Math.round(((start + loaded) / total) * 85));
        if (e.loaded >= e.total) {
          markFullySent();
        }
      }
    };
    xhr.upload.onload = markFullySent;

    xhr.onload = () => {
      watchdog.clear();
      if (xhr.status === 200 || xhr.status === 201) {
        try {
          const data = JSON.parse(xhr.responseText);
          if (data.error) {
            fail(errorFromPayload(xhr.status || 500, data));
          } else if (data.done === false) {
            done({ done: false });
          } else if (data.fileId) {
            done({ done: true, fileId: data.fileId as string });
          } else {
            fail(new Error("Storage did not return a file ID after upload"));
          }
        } catch {
          fail(new Error("Invalid response from upload server"));
        }
      } else {
        const error = errorFromPayload(xhr.status, parseJson(xhr.responseText || ""));
        fail(fullySent && isFinalChunk ? maybePostSendNonRetryable(error, xhr.status) : error);
      }
    };

    xhr.onerror = () => fail(fullySent
      ? postSendChunkError(
        isFinalChunk
          ? "The upload reached storage but the final response was lost. Check the media library before retrying."
          : "Network error while storage was acknowledging the chunk.",
        "network",
      )
      : new DriveUploadError("Network error during upload.", { reason: "network", retryable: true }));
    xhr.ontimeout = () => fail(fullySent
      ? postSendChunkError(
        isFinalChunk
          ? "The upload reached storage but timed out waiting for the final response. Check the media library before retrying."
          : "Upload timed out while storage was acknowledging the chunk.",
        "timeout",
      )
      : new DriveUploadError("Upload timed out.", { reason: "timeout", retryable: true }));
    xhr.onabort = () => fail(fullySent
      ? postSendChunkError(
        isFinalChunk
          ? "The upload reached storage but the final response was interrupted. Check the media library before retrying."
          : "Upload was interrupted while storage was acknowledging the chunk.",
        "network",
      )
      : new Error("Upload aborted"));
    watchdog.kick();
    xhr.send(chunk);
  });
}

// A single dropped chunk should re-send just that chunk against the still-valid
// resumable session, not discard the whole multi-chunk upload. Without this, a
// 100-250MB iPhone video (50-125 chunks) on flaky mobile/wifi got only ONE
// whole-file retry (PUT_RETRY_DELAYS) — two transient blips anywhere across the
// file restarted from byte 0 and then failed the entire upload.
const CHUNK_RETRY_DELAYS = process.env.NODE_ENV === "test" ? [1, 3] : [2000, 5000];

// Retry IN PLACE against the SAME resumable session for any TRANSIENT chunk failure:
// connection-phase drops (network/timeout — Google never returned a status, the offset is
// intact) AND server-returned transient 5xx/429 (serverError/driveRateLimited). The
// resumable protocol dedups by byte offset, so re-PUTting this exact range resumes from
// where the upload was — NOT a restart. Previously a single Google 503/429 on chunk 240 of
// a 250-chunk (500 MB) upload bubbled to the session-level retry, which re-minted the
// session and re-uploaded the WHOLE file from byte 0; a second blip then hard-failed it.
// auth / sessionInvalid / notFound / validation are deliberately NOT retried here — those
// mean the session or request is bad, so they bubble up to re-mint a fresh session.
function isResumableChunkRetryableInPlace(error: Error): boolean {
  if (error instanceof DriveUploadError) {
    return error.retryable && (
      error.reason === "network" ||
      error.reason === "timeout" ||
      error.reason === "serverError" ||
      error.reason === "driveRateLimited"
    );
  }
  // Generic client-side stall/no-response conditions from the xhr watchdog/timers.
  return /no progress for 30s|did not respond/i.test(error.message);
}

async function putResumableChunkWithRetry(
  file: File,
  session: ResumableUploadSession,
  folder: string,
  accessToken: string | undefined,
  workspaceId: string | undefined,
  start: number,
  end: number,
  onProgress: ProgressCallback | undefined
): Promise<{ done: boolean; fileId?: string }> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= CHUNK_RETRY_DELAYS.length; attempt++) {
    try {
	      return await uploadResumableChunk(file, session, folder, accessToken, workspaceId, start, end, onProgress);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (!isResumableChunkRetryableInPlace(lastError) || attempt >= CHUNK_RETRY_DELAYS.length) {
        throw lastError;
      }
      const delay = retryDelayWithJitter(CHUNK_RETRY_DELAYS[attempt]);
      console.warn(`[drive-upload] resumable chunk @${start} attempt ${attempt + 1} failed, retrying in ${delay}ms...`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastError || new Error("Resumable chunk failed");
}

async function putToGoogle(
  file: File,
  session: ResumableUploadSession,
  folder: string,
  workspaceId: string | undefined,
  onProgress: ProgressCallback | undefined
): Promise<string> {
  let accessToken = await getAccessTokenFromCurrentSession();
  for (let start = 0; start < file.size; start += DRIVE_RESUMABLE_CHUNK_SIZE) {
    // Refresh the Bearer before each chunk so a long upload (a 500 MB file on a slow uplink
    // can run >1 h, past the ~1 h Supabase JWT) never dies on an expired token mid-stream.
    // getSession() auto-refreshes; keep the last good token if a refresh read momentarily
    // hiccups, so a transient getSession blip can't fail an otherwise-healthy upload.
    try {
      const refreshed = await getAccessTokenFromCurrentSession();
      if (refreshed) accessToken = refreshed;
    } catch {
      /* keep the last good token */
    }
    const end = Math.min(start + DRIVE_RESUMABLE_CHUNK_SIZE, file.size) - 1;
	    const result = await putResumableChunkWithRetry(file, session, folder, accessToken, workspaceId, start, end, onProgress);
    if (result.done) {
      if (!result.fileId) throw new Error("Storage did not return a file ID after upload");
      return result.fileId;
    }
  }
  throw new Error("Storage did not return a file ID after upload");
}

async function finalizeUpload(fileId: string, folder: string, workspaceId?: string): Promise<DriveUploadResult> {
  const headers = await getAuthHeaders(workspaceId);
  const res = await fetchWithTimeout("/api/drive/finalize", {
    method: "POST",
    headers,
    body: JSON.stringify({ fileId, folder }),
  });

  if (!res.res.ok) {
    throw await errorFromResponse(res);
  }

  const data = await res.readJson() as Partial<DriveUploadResult>;
  if (!data.fileId) throw new Error("Finalize endpoint did not return a file ID");
  if (!data.url) throw new Error("Finalize endpoint did not return a media URL");
  return {
    fileId: data.fileId,
    url: data.url,
    publishUrl: data.publishUrl,
    driveProxyUrl: data.driveProxyUrl || data.url,
    mimeType: data.mimeType,
    size: data.size,
  };
}

async function uploadViaResumable(
  file: File,
  folder: string,
  workspaceId: string | undefined,
  cardId: string | undefined,
  onProgress: ProgressCallback | undefined
): Promise<DriveUploadResult> {
  onProgress?.(2);

  // Steps 1+2 together, under one retry. Each attempt mints a FRESH session and
  // then PUTs the bytes: re-PUTting a partially-consumed session URI is not
  // safe, so a retry must start a new session. Previously the PUT had no retry
  // at all, so any dropped connection failed the whole upload outright.
  const fileId = await withRetry(
    async () => {
	      const session = await getUploadSession(file, folder, cardId, workspaceId);
      onProgress?.(5);
      // The uploadUri is pre-authenticated, but browsers cannot PUT to it
      // directly because Google omits CORS headers. Send bounded same-origin
      // chunks and let the server forward them to the session URL.
	      return putToGoogle(file, session, folder, workspaceId, onProgress);
    },
    "Direct upload",
    PUT_RETRY_DELAYS,
  );
  onProgress?.(90);

  // Step 3: set permissions and get serving URL
  const result = await withRetry(
    () => finalizeUpload(fileId, folder, workspaceId),
    "Finalize"
  );
  onProgress?.(100);

  return result;
}

// ─── Public API ────────────────────────────────────────────────────────────

export async function uploadToDrive(
  file: File,
  folder: "thumbnails" | "raw-files" | "media-library",
  cardId?: string,
  onProgress?: ProgressCallback,
  workspaceId?: string,
): Promise<DriveUploadResult> {
  if (file.size === 0) throw new Error("Cannot upload empty file");
  if (file.size > MAX_DRIVE_MEDIA_FILE_SIZE) throw new Error(`File exceeds ${MAX_DRIVE_MEDIA_FILE_SIZE / (1024 * 1024)}MB limit.`);
  if (!isAllowedDriveUploadForFolder(folder, file.type, file.name)) throw new Error("Unsupported file type for this upload location.");

  onProgress?.(1);

  if (file.size >= RESUMABLE_THRESHOLD) {
    return uploadViaResumable(file, folder, workspaceId, cardId, onProgress);
  }
  return uploadViaProxy(file, folder, cardId, workspaceId, onProgress);
}

export async function reportUploadFailure(report: UploadFailureReport): Promise<void> {
  try {
    const accessToken = await getAccessTokenFromCurrentSession();
    if (!accessToken) return;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), UPLOAD_FAILURE_REPORT_TIMEOUT_MS);
    try {
      await fetch("/api/drive/upload-failure", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
          ...(report.workspaceId ? { "X-Workspace-Id": report.workspaceId } : {}),
        },
        body: JSON.stringify(report),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    console.error("[drive-upload] failure report failed:", err instanceof Error ? err.message : err);
  }
}

// ─── Batch upload (bounded concurrency) ──────────────────────────────────────

export interface BatchItemResult {
  /** Index within the input array, preserved regardless of completion order. */
  index: number;
  file: File;
  result?: DriveUploadResult;
  error?: Error;
}

/**
 * Upload many files with bounded concurrency instead of one-at-a-time.
 *
 * - At most `concurrency` uploads run at once (default 3).
 * - `onProgress` reports a size-weighted aggregate percent across the batch.
 * - Per-file failures are isolated: one failed file never prevents other files
 *   from starting or settling.
 * - Returns one BatchItemResult per input file, each tagged with its original
 *   `index`, so callers can map results back to input order.
 */
export async function uploadManyToDrive(
  files: File[],
  folder: "thumbnails" | "raw-files" | "media-library",
  opts: {
    cardId?: string;
    workspaceId?: string;
    concurrency?: number;
    /** @deprecated Per-file failures never abort the rest of the batch. */
    stopOnError?: boolean;
    onProgress?: ProgressCallback;
    onSettled?: (item: BatchItemResult) => void;
  } = {},
): Promise<BatchItemResult[]> {
  const { cardId, workspaceId, concurrency = 3, onProgress, onSettled } = opts;
  const total = files.length;
  if (total === 0) return [];
  const workerCount = Math.max(1, Math.min(total, Math.floor(Number.isFinite(concurrency) ? concurrency : 3)));

  const totalBytes = files.reduce((sum, f) => sum + (f.size || 1), 0);
  const filePercent = new Array<number>(total).fill(0);
  const emitProgress = () => {
    if (!onProgress) return;
    let weighted = 0;
    for (let i = 0; i < total; i++) weighted += (files[i].size || 1) * filePercent[i];
    const rounded = Math.round(weighted / totalBytes);
    onProgress(weighted > 0 && rounded === 0 ? 1 : rounded);
  };

  const settled = new Array<BatchItemResult | undefined>(total);
  let next = 0;

  const worker = async () => {
    while (true) {
      const i = next++;
      if (i >= total) return;
      const file = files[i];
      try {
        const result = await uploadToDrive(file, folder, cardId, (p) => {
          filePercent[i] = p;
          emitProgress();
        }, workspaceId);
        filePercent[i] = 100;
        emitProgress();
        const item: BatchItemResult = { index: i, file, result };
        settled[i] = item;
        try { onSettled?.(item); } catch { /* caller side effect, ignore */ }
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        const item: BatchItemResult = { index: i, file, error };
        settled[i] = item;
        try { onSettled?.(item); } catch { /* ignore */ }
      }
    }
  };

  await Promise.all(Array.from({ length: workerCount }, worker));
  return settled.filter((x): x is BatchItemResult => x !== undefined);
}
