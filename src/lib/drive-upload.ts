/**
 * Client-side Google Drive upload with retry logic + progress tracking.
 *
 * Flow:
 * 1. POST /api/drive/upload → get resumable uploadUri (with retry)
 * 2. PUT file to Google's uploadUri via XHR (progress events)
 * 3. POST /api/drive/finalize → set permissions, get serving URLs (with retry)
 *
 * Guarantees:
 * - Never returns a blob: URL
 * - 3-attempt exponential backoff on transient failures
 * - Throws on permanent failure (caller must handle)
 */

export interface DriveUploadResult {
  fileId: string;
  url: string;
  mimeType?: string;
  size?: number;
}

export type ProgressCallback = (percent: number) => void;

// Exponential backoff: 2s, 8s, 32s
const RETRY_DELAYS = [2000, 8000, 32000];

async function withRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      // Don't retry client errors (4xx)
      if (lastError.message.includes("400") || lastError.message.includes("401") || lastError.message.includes("403") || lastError.message.includes("404")) {
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

export async function uploadToDrive(
  file: File,
  folder: "thumbnails" | "raw-files" | "media-library",
  cardId?: string,
  onProgress?: ProgressCallback
): Promise<DriveUploadResult> {
  if (file.size === 0) throw new Error("Cannot upload empty file");
  if (file.size > 5 * 1024 * 1024 * 1024) throw new Error("File exceeds 5GB limit");

  // Step 1: Get resumable upload URI (with retry)
  onProgress?.(0);
  const { uploadUri } = await withRetry(async () => {
    const res = await fetch("/api/drive/upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fileName: file.name,
        mimeType: file.type || "application/octet-stream",
        folder,
        cardId,
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      throw new Error(err.error || `Upload init failed (${res.status})`);
    }
    return res.json();
  }, "Upload init");

  onProgress?.(5);

  // Step 2: Upload file directly to Google via XHR (no retry — resumable handles this)
  const fileId = await new Promise<string>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", uploadUri, true);
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        onProgress?.(Math.round(5 + (e.loaded / e.total) * 80));
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(85);
        try {
          const data = JSON.parse(xhr.responseText);
          resolve(data.id);
        } catch {
          reject(new Error("Upload completed but response missing file ID"));
        }
      } else {
        reject(new Error(`Google Drive upload failed: ${xhr.status}`));
      }
    };

    xhr.onerror = () => reject(new Error("Network error during upload to Google"));
    xhr.ontimeout = () => reject(new Error("Upload to Google timed out"));
    xhr.send(file);
  });

  // Step 3: Finalize — set permissions and get URLs (with retry)
  onProgress?.(90);
  const result = await withRetry(async () => {
    const res = await fetch("/api/drive/finalize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileId }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      throw new Error(err.error || `Finalize failed (${res.status})`);
    }
    return res.json();
  }, "Finalize");

  onProgress?.(100);

  return {
    fileId: result.fileId || fileId,
    url: result.url,
    mimeType: result.mimeType,
    size: result.size,
  };
}
