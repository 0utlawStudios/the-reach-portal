export const PLAYBACK_VIDEO_MIME_TYPES = ["video/mp4", "video/x-m4v", "video/quicktime", "video/webm"] as const;

// Supabase Storage rejects bucket limits above 50 MiB on this project. Keep
// playback copies within that enforced CDN-friendly object size and fall back
// to Drive streaming for larger canonical media.
export const MAX_PLAYBACK_VIDEO_FILE_SIZE = 50 * 1024 * 1024;
