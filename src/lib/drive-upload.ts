/**
 * Client-side Google Drive upload helper.
 *
 * Flow:
 * 1. POST /api/drive/upload with metadata → get resumable uploadUri + fileId + serving URLs
 * 2. PUT file body directly to Google's uploadUri (bypasses Vercel entirely)
 * 3. Return the permanent serving URL
 */

interface DriveUploadResult {
  fileId: string;
  /** CDN URL for images (lh3.googleusercontent.com) */
  imageUrl: string | null;
  /** Proxy URL for videos (/api/drive/stream?id=...) */
  streamUrl: string | null;
  /** The serving URL to use (imageUrl for images, streamUrl for videos) */
  url: string;
}

export async function uploadToDrive(
  file: File,
  folder: "thumbnails" | "raw-files" | "media-library",
  cardId?: string
): Promise<DriveUploadResult> {
  // Step 1: Get upload session from our API
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
    throw new Error(err.error || "Failed to initialize upload");
  }

  const { uploadUri, fileId, imageUrl, streamUrl } = await initRes.json();

  // Step 2: Upload file directly to Google (bypasses Vercel)
  const uploadRes = await fetch(uploadUri, {
    method: "PUT",
    headers: {
      "Content-Type": file.type || "application/octet-stream",
      "Content-Length": file.size.toString(),
    },
    body: file,
  });

  if (!uploadRes.ok) {
    throw new Error(`Upload to Google Drive failed: ${uploadRes.status}`);
  }

  // Determine the best serving URL
  const url = imageUrl || streamUrl || `https://drive.google.com/uc?id=${fileId}`;

  return { fileId, imageUrl, streamUrl, url };
}
