export const VALID_DRIVE_FOLDERS = ["thumbnails", "raw-files", "media-library"] as const;
export type DriveFolderName = (typeof VALID_DRIVE_FOLDERS)[number];

export const ALLOWED_DRIVE_VIEW_ROLES: ReadonlyArray<string> = [
  "superadmin",
  "admin",
  "owner",
  "approver",
  "creative_director",
  "editor",
  "social_media_specialist",
  "video_editor",
  "graphic_designer",
  "specialist",
  "technician",
  "viewer",
];

export const ALLOWED_DRIVE_UPLOAD_ROLES: ReadonlyArray<string> = ALLOWED_DRIVE_VIEW_ROLES.filter((role) => role !== "viewer");

export const ALLOWED_DRIVE_ROLES = ALLOWED_DRIVE_VIEW_ROLES;

export const ALLOWED_MEDIA_MIME_TYPES = new Set<string>([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
  "image/heic",
  "image/heic-sequence",
  "image/heif",
  "image/heif-sequence",
  "video/mp4",
  "video/x-m4v",
  "video/quicktime",
  "video/webm",
  "application/pdf",
  "text/plain",
  "text/csv",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/zip",
  "application/x-7z-compressed",
  "application/vnd.rar",
  "image/vnd.adobe.photoshop",
  "application/postscript",
  "application/vnd.adobe.aftereffects",
  "application/vnd.adobe.premiere",
  "application/x-sketch",
  "application/x-figma",
]);

// The ONE enforced upload ceiling. Every guard (client `uploadToDrive`, /api/drive/upload
// session, /api/drive/upload-chunk, /api/drive/finalize, /api/drive/proxy-upload) reads
// this single constant — do not introduce a second max-size number. Raised 250MB -> 500MB
// to cover long iPhone/ProRes .mov clips. A 500MB file is 250 chunks of 2MB, which is why
// the chunk-route rate limit is sized off this value (see DRIVE_UPLOAD_CHUNK_RATE_LIMIT).
export const MAX_DRIVE_MEDIA_FILE_SIZE = 500 * 1024 * 1024;
// The proxy path sends the whole file in one same-origin POST, so it MUST stay
// under Vercel's ~4.5 MB serverless request-body limit. Files at or above this
// route through the resumable (upload/upload-chunk) path instead. Do NOT raise
// this above ~4.5 MB without also reconfiguring the platform body-size limit, or
// Vercel rejects the body with an opaque 413 before the route's own size check
// can run (which the client cannot map to a friendly errorReason).
export const MAX_DRIVE_PROXY_FILE_SIZE = 4 * 1024 * 1024;
// 4 MB raw chunk = 16 × 256KB. Google requires non-final resumable chunks to be 256KB-aligned,
// and the chunk is sent as a RAW request body (no multipart overhead), so it can be larger than
// the multipart proxy threshold while staying a safe ~512KB under Vercel's ~4.5MB body limit.
// Doubled from 2MB so a 500MB file is 125 chunks instead of 250 — HALVING the per-chunk server
// round-trips (bearer auth verify + rate-limit read + HMAC verify + Google PUT setup) that
// dominate wall-clock. Large uploads here are latency-bound (sequential chunks through a proxy),
// not bandwidth-bound, so fewer, bigger chunks is the biggest in-place speedup. The true fix is a
// direct-to-storage path with no proxy (see PLAN-thereach-performance.md, Phase B / GCS).
export const DRIVE_RESUMABLE_CHUNK_SIZE = 4 * 1024 * 1024;

// Bounded-concurrency batch uploads run at most this many files at once
// (uploadManyToDrive default). Kept here so the chunk rate limit can be derived
// from it and never drift below what a real batch needs.
export const DRIVE_BATCH_CONCURRENCY = 3;

// A 500MB file is 125 sequential 4MB chunks, each a separate /api/drive/upload-chunk
// request. The chunk-route rate limit MUST stay above what a legitimate batch can emit
// in one window, or a large upload self-throttles into a 429 that the client (now)
// reports as a session/storage failure. Sized as: one max-size file's chunks ×
// (batch concurrency + 1 for in-place retry headroom) = 125 × 4 = 500/min/user.
export const DRIVE_UPLOAD_CHUNK_RATE_LIMIT =
  Math.ceil(MAX_DRIVE_MEDIA_FILE_SIZE / DRIVE_RESUMABLE_CHUNK_SIZE) * (DRIVE_BATCH_CONCURRENCY + 1);

const MIME_BY_EXTENSION: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  avif: "image/avif",
  heic: "image/heic",
  heif: "image/heif",
  mp4: "video/mp4",
  m4v: "video/x-m4v",
  mov: "video/quicktime",
  qt: "video/quicktime",
  webm: "video/webm",
  pdf: "application/pdf",
  txt: "text/plain",
  text: "text/plain",
  csv: "text/csv",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  zip: "application/zip",
  "7z": "application/x-7z-compressed",
  rar: "application/vnd.rar",
  psd: "image/vnd.adobe.photoshop",
  ai: "application/postscript",
  aep: "application/vnd.adobe.aftereffects",
  prproj: "application/vnd.adobe.premiere",
  sketch: "application/x-sketch",
  fig: "application/x-figma",
};

export function inferDriveMimeTypeFromName(fileName: unknown): string | null {
  if (typeof fileName !== "string") return null;
  const clean = fileName.split("?")[0]?.split("#")[0] || "";
  const ext = clean.includes(".") ? clean.split(".").pop()?.toLowerCase() : "";
  return ext ? MIME_BY_EXTENSION[ext] || null : null;
}

export function normalizeDriveMimeType(value: unknown, fileName?: unknown): string {
  const direct = typeof value === "string" && value.trim()
    ? value.split(";")[0].trim().toLowerCase()
    : "";
  if (direct && direct !== "application/octet-stream") return direct;
  return inferDriveMimeTypeFromName(fileName) || direct || "application/octet-stream";
}

export function isAllowedDriveMediaMime(mimeType: string): boolean {
  return ALLOWED_MEDIA_MIME_TYPES.has(normalizeDriveMimeType(mimeType));
}

export function isAllowedDriveUploadForFolder(folder: unknown, mimeType: unknown, fileName?: unknown): boolean {
  const normalized = normalizeDriveMimeType(mimeType, fileName);
  if (!ALLOWED_MEDIA_MIME_TYPES.has(normalized)) return false;
  return folder === "raw-files" || isDrivePublishableMediaMime(normalized);
}

export function isDriveVideoMime(mimeType: unknown, fileName?: unknown): boolean {
  return normalizeDriveMimeType(mimeType, fileName).startsWith("video/");
}

export function isDriveImageMime(mimeType: unknown, fileName?: unknown): boolean {
  return normalizeDriveMimeType(mimeType, fileName).startsWith("image/");
}

export function isDrivePublishableMediaMime(mimeType: unknown, fileName?: unknown): boolean {
  const normalized = normalizeDriveMimeType(mimeType, fileName);
  return normalized.startsWith("image/") || normalized.startsWith("video/");
}
