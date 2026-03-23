/**
 * Client-side Google Drive upload with progress tracking.
 *
 * Flow:
 * 1. POST /api/drive/upload → get resumable uploadUri
 * 2. PUT file to Google's uploadUri via XHR (progress events) → get fileId
 * 3. POST /api/drive/finalize → set permissions, get serving URLs
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

  // Step 1: Get resumable upload URI from our API
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

  const { uploadUri } = await initRes.json();
  onProgress?.(5);

  // Step 2: Upload file directly to Google via XHR (for progress + CORS compatibility)
  const fileId = await new Promise<string>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", uploadUri, true);
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        const pct = Math.round(5 + (e.loaded / e.total) * 85);
        onProgress?.(pct);
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(90);
        try {
          const data = JSON.parse(xhr.responseText);
          resolve(data.id);
        } catch {
          reject(new Error("Upload completed but could not parse response"));
        }
      } else {
        reject(new Error(`Drive upload failed: ${xhr.status} ${xhr.statusText}`));
      }
    };

    xhr.onerror = () => reject(new Error("CORS or network error — check browser console"));
    xhr.ontimeout = () => reject(new Error("Upload timed out"));
    xhr.send(file);
  });

  // Step 3: Finalize — set permissions and get serving URLs
  onProgress?.(95);
  const finalRes = await fetch("/api/drive/finalize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fileId }),
  });

  if (!finalRes.ok) {
    // File uploaded but finalize failed — still return basic URL
    onProgress?.(100);
    return {
      fileId,
      imageUrl: null,
      streamUrl: null,
      url: `https://drive.google.com/uc?id=${fileId}`,
    };
  }

  const result = await finalRes.json();
  onProgress?.(100);

  return {
    fileId: result.fileId,
    imageUrl: result.imageUrl,
    streamUrl: result.streamUrl,
    url: result.url,
  };
}
