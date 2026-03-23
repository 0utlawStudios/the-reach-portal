/**
 * Client-side Google Drive upload helper with progress tracking.
 *
 * Flow:
 * 1. POST /api/drive/upload with metadata → get resumable uploadUri + fileId + serving URLs
 * 2. PUT file body directly to Google's uploadUri via XHR (progress events)
 * 3. Return the permanent serving URL
 */

export interface DriveUploadResult {
  fileId: string;
  imageUrl: string | null;
  streamUrl: string | null;
  url: string;
}

export type ProgressCallback = (percent: number) => void;

export async function uploadToDrive(
  file: File,
  folder: "thumbnails" | "raw-files" | "media-library",
  cardId?: string,
  onProgress?: ProgressCallback
): Promise<DriveUploadResult> {
  if (file.size === 0) throw new Error("Cannot upload empty file");
  if (file.size > 5 * 1024 * 1024 * 1024) throw new Error("File exceeds 5GB limit");

  // Step 1: Get upload session from our API
  onProgress?.(0);
  const initRes = await fetch("/api/drive/upload", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fileName: file.name,
      mimeType: file.type || "application/octet-stream",
      folder,
      cardId,
    }),
  });

  if (!initRes.ok) {
    const err = await initRes.json().catch(() => ({ error: "Upload init failed" }));
    throw new Error(err.error || `Upload init failed (${initRes.status})`);
  }

  const { uploadUri, fileId, imageUrl, streamUrl } = await initRes.json();
  onProgress?.(5);

  // Step 2: Upload file directly to Google via XHR (for progress events)
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", uploadUri, true);
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        // Scale from 5-100 (5% was the init phase)
        const pct = Math.round(5 + (e.loaded / e.total) * 95);
        onProgress?.(pct);
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(100);
        resolve();
      } else {
        reject(new Error(`Drive upload failed: ${xhr.status} ${xhr.statusText}`));
      }
    };

    xhr.onerror = () => reject(new Error("Network error during Drive upload"));
    xhr.ontimeout = () => reject(new Error("Drive upload timed out"));
    xhr.send(file);
  });

  const url = imageUrl || streamUrl || `https://drive.google.com/uc?id=${fileId}`;
  return { fileId, imageUrl, streamUrl, url };
}
