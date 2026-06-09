/**
 * Client-side Google Drive upload — two paths based on file size.
 *
 * Small files (< 4 MB): proxy path
 *   Client → /api/drive/proxy-upload (FormData) → Google Drive → returns fileId + URL
 *   One round-trip, proven, fast for thumbnails and small images.
 *
 * Large files (≥ 4 MB): resumable path (bypasses Vercel's 4.5 MB body limit)
 *   1. Client → /api/drive/upload (JSON metadata) → returns uploadUri
 *   2. Client → uploadUri (PUT file bytes directly to Google, CORS-safe)
 *   3. Client → /api/drive/finalize (JSON fileId) → sets permissions, returns URL
 *
 * The uploadUri is a pre-authenticated Google URL — the service account token
 * is baked in server-side. The browser PUTs directly without any auth header.
 * Google's resumable upload endpoints return Access-Control-Allow-Origin: *
 * so CORS is not an issue.
 *
 * Guarantees:
 * - Never returns a blob: URL
 * - 3-attempt exponential backoff on transient failures
 * - Throws on permanent failure (caller must handle)
 * - 413 is treated as permanent (not retried)
 */

import {
  isAllowedDriveUploadForFolder,
  MAX_DRIVE_MEDIA_FILE_SIZE,
  normalizeDriveMimeType,
} from "@/lib/drive-policy";

export interface DriveUploadResult {
  fileId: string;
  url: string;
  mimeType?: string;
  size?: number;
}

export type ProgressCallback = (percent: number) => void;

export interface UploadFailureReport {
  phase?: string;
  route?: string;
  uploadPath?: "proxy" | "resumable" | "unknown";
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

// Interactive-friendly backoff. The old [2000, 8000, 32000] meant a single
// transient hiccup cost up to 42s of dead waiting (and the proxy path re-sent
// the whole file each time). Worst case is now ~11s.
const RETRY_DELAYS = [1000, 3000, 7000];

// A large direct-to-Google upload is expensive to repeat, so it gets a single
// gentle retry rather than the full ladder.
const PUT_RETRY_DELAYS = [3000];

// Abort an upload that makes no progress for this long. XMLHttpRequest has no
// default timeout, so without this a stalled connection hangs with no end —
// the literal "upload took forever" symptom. The watchdog resets on every
// progress event, so a slow-but-moving upload is never killed.
const STALL_TIMEOUT_MS = 30000;
const PROXY_TOTAL_TIMEOUT_MS = 120000;
const DIRECT_RESPONSE_TIMEOUT_MS = 120000;

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

async function withRetry<T>(fn: () => Promise<T>, label: string, delays: number[] = RETRY_DELAYS): Promise<T> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      // Permanent failures — do not retry
      if (
        lastError.message.includes("400") ||
        lastError.message.includes("401") ||
        lastError.message.includes("403") ||
        lastError.message.includes("404") ||
        lastError.message.includes("429") ||
        lastError.message.includes("413")
      ) {
        throw lastError;
      }
      if (attempt < delays.length) {
        console.warn(`[drive-upload] ${label} attempt ${attempt + 1} failed, retrying in ${delays[attempt]}ms...`);
        await new Promise((r) => setTimeout(r, delays[attempt]));
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
      try { xhr.abort(); } catch { /* already settled */ }
      onStall();
    }, STALL_TIMEOUT_MS);
  };
  return { kick, clear };
}

// fetch() has no default timeout, so a slow or dead endpoint can leave the
// "finishing up" step hanging with no end — a card stuck below 100% forever.
// The AbortController bounds it; withRetry treats the resulting error as
// retryable, and the message stays honest for the user.
const FETCH_TIMEOUT_MS = 45000;
async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = FETCH_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (controller.signal.aborted) throw new Error("Upload timed out");
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// ─── Proxy path (< 4 MB) ───────────────────────────────────────────────────

async function uploadViaProxy(
  file: File,
  folder: string,
  cardId: string | undefined,
  onProgress: ProgressCallback | undefined
): Promise<DriveUploadResult> {
  return withRetry(async () => {
    // The proxy route requires a Bearer token (SEC-001 hardening). Attach the
    // caller's current session token, mirroring the resumable path's headers.
    const { supabase } = await import("@/lib/supabaseClient");
    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData.session?.access_token;

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
      const fail = (err: Error) => { if (settled) return; settled = true; watchdog.clear(); reject(err); };
      const done = (value: DriveUploadResult) => { if (settled) return; settled = true; watchdog.clear(); resolve(value); };
      const watchdog = makeStallWatchdog(xhr, () => fail(new Error("Upload stalled (no progress for 30s)")));

      xhr.open("POST", "/api/drive/proxy-upload", true);
      xhr.timeout = PROXY_TOTAL_TIMEOUT_MS;
      if (accessToken) xhr.setRequestHeader("Authorization", `Bearer ${accessToken}`);

      xhr.upload.onprogress = (e) => {
        watchdog.kick();
        if (e.lengthComputable) {
          onProgress?.(Math.round((e.loaded / e.total) * 90));
          if (e.loaded >= e.total) {
            watchdog.clear();
            onProgress?.(92);
          }
        }
      };

      xhr.onload = () => {
        watchdog.clear();
        onProgress?.(95);
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const data = JSON.parse(xhr.responseText);
            if (data.error) {
              fail(new Error(data.error));
            } else {
              onProgress?.(100);
              done({
                fileId: data.fileId,
                url: data.url,
                mimeType: data.mimeType,
                size: data.size,
              });
            }
          } catch {
            fail(new Error("Invalid response from upload server"));
          }
        } else {
          try {
            const data = JSON.parse(xhr.responseText);
            fail(new Error(data.error || `Upload failed: ${xhr.status}`));
          } catch {
            fail(new Error(`Upload failed: ${xhr.status}`));
          }
        }
      };

      xhr.onerror = () => fail(new Error("Network error during upload"));
      xhr.ontimeout = () => fail(new Error("Upload timed out"));
      xhr.onabort = () => fail(new Error("Upload aborted"));
      watchdog.kick();
      xhr.send(formData);
    });
  }, "Proxy upload");
}

// ─── Resumable path (≥ 4 MB) ──────────────────────────────────────────────

async function getAuthHeaders(): Promise<HeadersInit> {
  const { supabase } = await import("@/lib/supabaseClient");
  const { data } = await supabase.auth.getSession();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (data.session?.access_token) {
    headers.Authorization = `Bearer ${data.session.access_token}`;
  }
  return headers;
}

async function getUploadSession(
  file: File,
  folder: string,
  cardId: string | undefined
): Promise<string> {
  const headers = await getAuthHeaders();
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

  if (!res.ok) {
    let msg = `Session creation failed: ${res.status}`;
    try {
      const data = await res.json();
      if (data.error) msg = data.error;
    } catch { /* ignore */ }
    throw new Error(msg);
  }

  const data = await res.json();
  if (!data.uploadUri) throw new Error("No uploadUri returned from session endpoint");
  return data.uploadUri;
}

async function putToGoogle(
  file: File,
  uploadUri: string,
  onProgress: ProgressCallback | undefined
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let settled = false;
    let responseTimer: ReturnType<typeof setTimeout> | null = null;
    const clearResponseTimer = () => {
      if (responseTimer) { clearTimeout(responseTimer); responseTimer = null; }
    };
    const armResponseTimer = () => {
      clearResponseTimer();
      responseTimer = setTimeout(() => {
        fail(new Error("Upload finished sending but storage did not respond"));
      }, DIRECT_RESPONSE_TIMEOUT_MS);
    };
    const fail = (err: Error) => { if (settled) return; settled = true; watchdog.clear(); clearResponseTimer(); reject(err); };
    const done = (id: string) => { if (settled) return; settled = true; watchdog.clear(); clearResponseTimer(); resolve(id); };
    const watchdog = makeStallWatchdog(xhr, () => fail(new Error("Upload stalled (no progress for 30s)")));

    xhr.open("PUT", uploadUri, true);
    xhr.setRequestHeader("Content-Type", normalizeDriveMimeType(file.type, file.name));

    xhr.upload.onprogress = (e) => {
      watchdog.kick();
      if (e.lengthComputable) {
        // Map to 5–90% of overall progress
        onProgress?.(5 + Math.round((e.loaded / e.total) * 85));
        if (e.loaded >= e.total) {
          watchdog.clear();
          armResponseTimer();
        }
      }
    };

    xhr.onload = () => {
      watchdog.clear();
      if (xhr.status === 200 || xhr.status === 201) {
        try {
          const data = JSON.parse(xhr.responseText);
          if (!data.id) {
            fail(new Error("Storage did not return a file ID after upload"));
          } else {
            done(data.id as string);
          }
        } catch {
          fail(new Error("Invalid response from storage after upload"));
        }
      } else {
        fail(new Error(`Upload to storage failed: ${xhr.status}`));
      }
    };

    xhr.onerror = () => fail(new Error("Network error during upload"));
    xhr.ontimeout = () => fail(new Error("Upload timed out"));
    xhr.onabort = () => fail(new Error("Upload aborted"));
    watchdog.kick();
    xhr.send(file);
  });
}

async function finalizeUpload(fileId: string): Promise<DriveUploadResult> {
  const headers = await getAuthHeaders();
  const res = await fetchWithTimeout("/api/drive/finalize", {
    method: "POST",
    headers,
    body: JSON.stringify({ fileId }),
  });

  if (!res.ok) {
    let msg = `Finalize failed: ${res.status}`;
    try {
      const data = await res.json();
      if (data.error) msg = data.error;
    } catch { /* ignore */ }
    throw new Error(msg);
  }

  const data = await res.json();
  return {
    fileId: data.fileId,
    url: data.url,
    mimeType: data.mimeType,
    size: data.size,
  };
}

async function uploadViaResumable(
  file: File,
  folder: string,
  cardId: string | undefined,
  onProgress: ProgressCallback | undefined
): Promise<DriveUploadResult> {
  onProgress?.(0);

  // Steps 1+2 together, under one retry. Each attempt mints a FRESH session and
  // then PUTs the bytes: re-PUTting a partially-consumed session URI is not
  // safe, so a retry must start a new session. Previously the PUT had no retry
  // at all, so any dropped connection failed the whole upload outright.
  const fileId = await withRetry(
    async () => {
      const uploadUri = await getUploadSession(file, folder, cardId);
      onProgress?.(5);
      // The uploadUri is pre-authenticated, so the browser PUTs straight to
      // storage with no auth header and no server hop for the bytes.
      return putToGoogle(file, uploadUri, onProgress);
    },
    "Direct upload",
    PUT_RETRY_DELAYS,
  );
  onProgress?.(90);

  // Step 3: set permissions and get serving URL
  const result = await withRetry(
    () => finalizeUpload(fileId),
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
  onProgress?: ProgressCallback
): Promise<DriveUploadResult> {
  if (file.size === 0) throw new Error("Cannot upload empty file");
  if (file.size > MAX_DRIVE_MEDIA_FILE_SIZE) throw new Error(`File exceeds ${MAX_DRIVE_MEDIA_FILE_SIZE / (1024 * 1024)}MB limit.`);
  if (!isAllowedDriveUploadForFolder(folder, file.type, file.name)) throw new Error("Unsupported file type for this upload location.");

  onProgress?.(0);

  if (file.size >= RESUMABLE_THRESHOLD) {
    return uploadViaResumable(file, folder, cardId, onProgress);
  }
  return uploadViaProxy(file, folder, cardId, onProgress);
}

export async function reportUploadFailure(report: UploadFailureReport): Promise<void> {
  try {
    const { supabase } = await import("@/lib/supabaseClient");
    const { data } = await supabase.auth.getSession();
    const accessToken = data.session?.access_token;
    if (!accessToken) return;
    await fetch("/api/drive/upload-failure", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(report),
    });
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
    concurrency?: number;
    /** @deprecated Per-file failures never abort the rest of the batch. */
    stopOnError?: boolean;
    onProgress?: ProgressCallback;
    onSettled?: (item: BatchItemResult) => void;
  } = {},
): Promise<BatchItemResult[]> {
  const { cardId, concurrency = 3, onProgress, onSettled } = opts;
  const total = files.length;
  if (total === 0) return [];

  const totalBytes = files.reduce((sum, f) => sum + (f.size || 1), 0);
  const filePercent = new Array<number>(total).fill(0);
  const emitProgress = () => {
    if (!onProgress) return;
    let weighted = 0;
    for (let i = 0; i < total; i++) weighted += (files[i].size || 1) * filePercent[i];
    onProgress(Math.round(weighted / totalBytes));
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
        });
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

  await Promise.all(Array.from({ length: Math.min(concurrency, total) }, worker));
  return settled.filter((x): x is BatchItemResult => x !== undefined);
}
