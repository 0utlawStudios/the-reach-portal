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

export interface DriveUploadResult {
  fileId: string;
  url: string;
  mimeType?: string;
  size?: number;
}

export type ProgressCallback = (percent: number) => void;

const RETRY_DELAYS = [2000, 8000, 32000];

// Files at or above this threshold use the resumable path to avoid Vercel's 4.5 MB body limit.
const RESUMABLE_THRESHOLD = 4 * 1024 * 1024; // 4 MB

// Instagram video limit (250 MB) — largest common platform constraint.
const MAX_FILE_SIZE = 250 * 1024 * 1024; // 250 MB

async function withRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
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
        lastError.message.includes("413")
      ) {
        throw lastError;
      }
      if (attempt < RETRY_DELAYS.length) {
        console.warn(`[drive-upload] ${label} attempt ${attempt + 1} failed, retrying in ${RETRY_DELAYS[attempt]}ms...`);
        await new Promise((r) => setTimeout(r, RETRY_DELAYS[attempt]));
      }
    }
  }
  throw lastError || new Error(`${label} failed after ${RETRY_DELAYS.length + 1} attempts`);
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

    const formData = new FormData();
    formData.append("file", file);
    formData.append("folder", folder);
    formData.append("fileName", file.name);
    formData.append("mimeType", file.type || "application/octet-stream");
    if (cardId) formData.append("cardId", cardId);

    return new Promise<DriveUploadResult>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/drive/proxy-upload", true);
      if (accessToken) xhr.setRequestHeader("Authorization", `Bearer ${accessToken}`);

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          onProgress?.(Math.round((e.loaded / e.total) * 90));
        }
      };

      xhr.onload = () => {
        onProgress?.(95);
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const data = JSON.parse(xhr.responseText);
            if (data.error) {
              reject(new Error(data.error));
            } else {
              onProgress?.(100);
              resolve({
                fileId: data.fileId,
                url: data.url,
                mimeType: data.mimeType,
                size: data.size,
              });
            }
          } catch {
            reject(new Error("Invalid response from upload server"));
          }
        } else {
          try {
            const data = JSON.parse(xhr.responseText);
            reject(new Error(data.error || `Upload failed: ${xhr.status}`));
          } catch {
            reject(new Error(`Upload failed: ${xhr.status}`));
          }
        }
      };

      xhr.onerror = () => reject(new Error("Network error during upload"));
      xhr.ontimeout = () => reject(new Error("Upload timed out"));
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
  const res = await fetch("/api/drive/upload", {
    method: "POST",
    headers,
    body: JSON.stringify({
      fileName: file.name,
      mimeType: file.type || "application/octet-stream",
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
    xhr.open("PUT", uploadUri, true);
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        // Map to 5–90% of overall progress
        onProgress?.(5 + Math.round((e.loaded / e.total) * 85));
      }
    };

    xhr.onload = () => {
      if (xhr.status === 200 || xhr.status === 201) {
        try {
          const data = JSON.parse(xhr.responseText);
          if (!data.id) {
            reject(new Error("Google did not return a file ID after upload"));
          } else {
            resolve(data.id as string);
          }
        } catch {
          reject(new Error("Invalid response from Google after upload"));
        }
      } else {
        reject(new Error(`Upload to Google failed: ${xhr.status}`));
      }
    };

    xhr.onerror = () => reject(new Error("Network error during upload to Google"));
    xhr.ontimeout = () => reject(new Error("Upload to Google timed out"));
    xhr.send(file);
  });
}

async function finalizeUpload(fileId: string): Promise<DriveUploadResult> {
  const res = await fetch("/api/drive/finalize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
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

  // Step 1: create resumable session (returns uploadUri)
  const uploadUri = await withRetry(
    () => getUploadSession(file, folder, cardId),
    "Session creation"
  );
  onProgress?.(5);

  // Step 2: PUT file directly to Google (bypasses Vercel)
  // The uploadUri is pre-authenticated — no auth headers needed.
  // Google resumable upload endpoints are CORS-safe (Access-Control-Allow-Origin: *).
  const fileId = await putToGoogle(file, uploadUri, onProgress);
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
  if (file.size > MAX_FILE_SIZE) throw new Error(`File exceeds ${MAX_FILE_SIZE / (1024 * 1024)}MB limit.`);

  onProgress?.(0);

  if (file.size >= RESUMABLE_THRESHOLD) {
    return uploadViaResumable(file, folder, cardId, onProgress);
  }
  return uploadViaProxy(file, folder, cardId, onProgress);
}
