export const VALID_DRIVE_FOLDERS = ["thumbnails", "raw-files", "media-library"] as const;
export type DriveFolderName = (typeof VALID_DRIVE_FOLDERS)[number];

export const ALLOWED_DRIVE_ROLES: ReadonlyArray<string> = [
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

export const ALLOWED_MEDIA_MIME_TYPES = new Set<string>([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
  "video/mp4",
  "video/quicktime",
  "video/webm",
]);

export const MAX_DRIVE_MEDIA_FILE_SIZE = 250 * 1024 * 1024;
export const MAX_DRIVE_PROXY_FILE_SIZE = 4 * 1024 * 1024;

export function normalizeDriveMimeType(value: unknown): string {
  return typeof value === "string" && value.trim()
    ? value.split(";")[0].trim().toLowerCase()
    : "application/octet-stream";
}

export function isAllowedDriveMediaMime(mimeType: string): boolean {
  return ALLOWED_MEDIA_MIME_TYPES.has(normalizeDriveMimeType(mimeType));
}
