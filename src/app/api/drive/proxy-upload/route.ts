import { NextRequest } from "next/server";
import {
  getRootFolderId,
  ensureSubfolder,
  setPublicPermission,
  getAccessToken,
} from "@/lib/google-drive";
import { consume, getClientIp } from "@/lib/rate-limit";
import { requireBearerTeamRole } from "@/lib/auth/require";

export const maxDuration = 60;

const VALID_FOLDERS = ["thumbnails", "raw-files", "media-library"] as const;
const ALLOWED_DRIVE_ROLES: ReadonlyArray<string> = [
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

// SEC-001: Allowed MIME types for proxy-uploaded media. Mirrors the formats
// the rest of the pipeline (Drive thumbnails, video preview, IG/FB targets)
// can actually display. Anything else gets rejected before we burn Drive quota.
const ALLOWED_MIME_TYPES = new Set<string>([
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

// Helper: always return clean JSON (no control characters ever)
function jsonResponse(data: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireBearerTeamRole(request, ALLOWED_DRIVE_ROLES);
    if (auth instanceof Response) return auth;
    const { user } = auth;

    // SEC-001: 30/min/user. Tighter than drive/upload (which only mints a
    // resumable URL) because each call here actually streams bytes through
    // our serverless host.
    const rlKey = `user:${user.id}|ip:${getClientIp(request)}`;
    const rl = await consume("drive-proxy-upload:user", rlKey, 30, 60);
    if (!rl.allowed) {
      return jsonResponse({ error: "Too many uploads. Please slow down." }, 429);
    }

    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const folder = formData.get("folder") as string;
    const fileName = formData.get("fileName") as string || file?.name || "upload";
    const mimeType = formData.get("mimeType") as string || file?.type || "application/octet-stream";

    if (!file || !(file instanceof File)) {
      return jsonResponse({ error: "No file provided" }, 400);
    }
    if (!VALID_FOLDERS.includes(folder as typeof VALID_FOLDERS[number])) {
      return jsonResponse({ error: "Invalid folder" }, 400);
    }
    // SEC-001: MIME allowlist. Reject anything we don't render downstream
    // BEFORE allocating a Drive resumable session.
    if (!ALLOWED_MIME_TYPES.has(mimeType)) {
      return jsonResponse({ error: "Unsupported media type" }, 415);
    }

    // Resolve subfolder
    const rootId = getRootFolderId();
    const parentId = await ensureSubfolder(folder, rootId);

    // Build filename
    // Human-readable filename: 2026-04-01_08-32-15_originalname.ext
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 19).replace("T", "_").replace(/:/g, "-");
    const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/_+/g, "_");
    const driveFileName = `${dateStr}_${safeName}`;

    // Get auth token
    const token = await getAccessToken();

    // Upload to Google Drive using multipart upload
    const boundary = "the_reach_" + Date.now();
    const metadata = JSON.stringify({
      name: driveFileName,
      parents: [parentId],
      mimeType,
    });

    const fileBuffer = Buffer.from(await file.arrayBuffer());

    const multipartBody = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n` +
        `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`
      ),
      fileBuffer,
      Buffer.from(`\r\n--${boundary}--`),
    ]);

    const uploadRes = await fetch(
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,size&supportsAllDrives=true",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": `multipart/related; boundary=${boundary}`,
        },
        body: multipartBody,
      }
    );

    if (!uploadRes.ok) {
      // Log the full error server-side, return clean message to client
      const rawErr = await uploadRes.text();
      console.error("[proxy-upload] Google Drive error:", uploadRes.status, rawErr);
      return jsonResponse({ error: `Google Drive rejected the upload (HTTP ${uploadRes.status}). Check that the service account has Content Manager access to the Shared Drive.` }, 500);
    }

    const driveFile = await uploadRes.json();
    const fileId = driveFile.id;

    if (!fileId) {
      console.error("[proxy-upload] No fileId in Google response:", driveFile);
      return jsonResponse({ error: "Upload succeeded but Google did not return a file ID" }, 500);
    }

    // Set public permission
    try {
      await setPublicPermission(fileId);
    } catch (permErr) {
      console.error("[proxy-upload] Permission error (file still uploaded):", permErr);
      // Don't fail — file is uploaded, just not public yet
    }

    return jsonResponse({
      fileId,
      url: `/api/drive/stream?id=${fileId}`,
      mimeType: driveFile.mimeType || mimeType,
      size: Number(driveFile.size || file.size),
      driveFileName,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown server error";
    console.error("[proxy-upload] Error:", message);
    // Return clean error — never include raw stack traces or Google API responses
    return jsonResponse({ error: message.slice(0, 200) }, 500);
  }
}
