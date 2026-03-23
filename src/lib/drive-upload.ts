/**
 * Client-side Google Drive upload via server proxy.
 *
 * Flow: Client → /api/drive/proxy-upload (FormData) → Google Drive → returns fileId + URL
 *
 * Why proxy: Google Drive's resumable upload URIs don't support CORS for
 * browser uploads initiated by service accounts. Proxying through our API
 * eliminates CORS entirely — the upload is same-origin.
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

const RETRY_DELAYS = [2000, 8000, 32000];

async function withRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
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
  if (file.size > 25 * 1024 * 1024) throw new Error("File exceeds 25MB limit. Contact admin for larger files.");

  onProgress?.(0);

  const result = await withRetry(async () => {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("folder", folder);
    formData.append("fileName", file.name);
    formData.append("mimeType", file.type || "application/octet-stream");
    if (cardId) formData.append("cardId", cardId);

    // Use XHR for progress tracking on same-origin request
    return new Promise<DriveUploadResult>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/drive/proxy-upload", true);

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
  }, "Upload");

  return result;
}
