export function getPublicDriveDownloadUrl(fileId: string): string {
  const params = new URLSearchParams({ export: "download", id: fileId });
  return `https://drive.google.com/uc?${params.toString()}`;
}

// Drive file IDs are base64-url-ish, ~20-80 chars. Same shape guard the finalize route
// uses before handing an ID to the Drive API.
export const DRIVE_FILE_ID_RE = /^[a-zA-Z0-9_-]{20,80}$/;

// Resolves the Drive file ID embedded in an app media URL (e.g.
// "/api/drive/stream?id=<fileId>" or an absolute publish URL "...stream?id=<fileId>&token=..").
// Returns null for anything that is not a valid app stream URL with a well-formed id.
// The delete-media route uses this on SERVER-loaded media_assets URLs, never a
// browser-supplied value, so a user cannot point deletion at an arbitrary Drive file.
export function extractDriveFileIdFromAppUrl(url: unknown): string | null {
  if (typeof url !== "string" || !url) return null;
  let id: string | null = null;
  try {
    // Tolerate relative app URLs by giving the parser a dummy base.
    const parsed = new URL(url, "https://placeholder.local");
    id = parsed.searchParams.get("id");
  } catch {
    return null;
  }
  if (!id) return null;
  return DRIVE_FILE_ID_RE.test(id) ? id : null;
}
