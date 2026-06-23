import { NextRequest } from "next/server";
import {
  getRootFolderId,
  ensureSubfolder,
  setPublicPermission,
  getAccessToken,
  getStreamUrl,
  getDriveDownloadUrl,
} from "@/lib/google-drive";
import { consume, getClientIp } from "@/lib/rate-limit";
import { requireBearerTeamRole } from "@/lib/auth/require";
import {
  ALLOWED_DRIVE_ROLES,
  isAllowedDriveUploadForFolder,
  MAX_DRIVE_MEDIA_FILE_SIZE,
  MAX_DRIVE_PROXY_FILE_SIZE,
  normalizeDriveMimeType,
  VALID_DRIVE_FOLDERS,
} from "@/lib/drive-policy";
import { notifyUploadFailure } from "@/lib/upload-alerts";
import {
  appRateLimitError,
  sanitizeGoogleDriveError,
  sanitizeUnknownUploadError,
  statusForSanitizedDriveError,
} from "@/lib/drive-errors";

// Pinned: this route uses Node Buffer APIs to assemble the multipart body and
// relies on Vercel's ~4.5 MB body limit (see MAX_DRIVE_PROXY_FILE_SIZE). Never
// switch it to the edge runtime.
export const runtime = "nodejs";
export const maxDuration = 60;

// Helper: always return clean JSON (no control characters ever)
function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function POST(request: NextRequest) {
  let authContext: { user: { id: string }; email: string; role: string; workspaceId: string } | null = null;
  let fileName = "";
  let mimeType = "";
  let folder = "";
  let fileSize = 0;
  try {
    const auth = await requireBearerTeamRole(request, ALLOWED_DRIVE_ROLES);
    if (auth instanceof Response) return auth;
    authContext = auth;
    const { user } = auth;

    // 60/min/user. The proxy path is the primary route for every file under 4 MB
    // (one round-trip per file), so a multi-file batch — e.g. a 26-photo upload —
    // must not trip the limit. Matches drive/upload's 60/min envelope.
    const rlKey = `user:${user.id}|ip:${getClientIp(request)}`;
    const rl = await consume("drive-proxy-upload:user", rlKey, 60, 60);
    if (!rl.allowed) {
      return jsonResponse(appRateLimitError(rl.resetAt), 429);
    }

    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    folder = formData.get("folder") as string;
    fileName = formData.get("fileName") as string || file?.name || "upload";
    fileSize = Number(file?.size || 0);
    mimeType = normalizeDriveMimeType(formData.get("mimeType") || file?.type, fileName);

    if (!file || !(file instanceof File)) {
      return jsonResponse({ error: "No file provided" }, 400);
    }
    if (!VALID_DRIVE_FOLDERS.includes(folder as typeof VALID_DRIVE_FOLDERS[number])) {
      return jsonResponse({ error: "Invalid folder" }, 400);
    }
    if (!isAllowedDriveUploadForFolder(folder, mimeType, fileName)) {
      return jsonResponse({ error: "Unsupported file type for this upload folder" }, 415);
    }
    if (file.size > MAX_DRIVE_MEDIA_FILE_SIZE) {
      return jsonResponse({ error: `File exceeds ${MAX_DRIVE_MEDIA_FILE_SIZE / (1024 * 1024)}MB limit.` }, 413);
    }
    if (file.size > MAX_DRIVE_PROXY_FILE_SIZE) {
      return jsonResponse(
        { error: `File exceeds the ${MAX_DRIVE_PROXY_FILE_SIZE / (1024 * 1024)}MB proxy limit. Use resumable upload.` },
        413,
      );
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

    const uploadController = new AbortController();
    const uploadTimer = setTimeout(() => uploadController.abort(), 45000);
    let uploadRes: Response;
    try {
      uploadRes = await fetch(
        "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,size&supportsAllDrives=true",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": `multipart/related; boundary=${boundary}`,
          },
          body: multipartBody,
          signal: uploadController.signal,
        }
      );
    } finally {
      clearTimeout(uploadTimer);
    }

    if (!uploadRes.ok) {
      // Log the full error server-side, return clean message to client
      const rawErr = await uploadRes.text();
      const sanitized = sanitizeGoogleDriveError(uploadRes.status, rawErr);
      console.error("[proxy-upload] Google Drive error:", uploadRes.status, rawErr);
      await notifyUploadFailure({
        source: "server",
        phase: "proxy_drive_upload",
        route: "/api/drive/proxy-upload",
        uploadPath: "proxy",
        workspaceId: authContext.workspaceId,
        userId: authContext.user.id,
        userEmail: authContext.email,
        userRole: authContext.role,
        folder,
        fileName,
        mimeType,
        fileSize,
        errorStatus: uploadRes.status,
        errorMessage: sanitized.error,
        errorDetail: rawErr,
        userAgent: request.headers.get("user-agent"),
        ip: getClientIp(request),
        requestUrl: request.url,
      });
      return jsonResponse(sanitized, statusForSanitizedDriveError(sanitized, 500));
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

    const driveProxyUrl = getStreamUrl(fileId);
    const publishUrl = getDriveDownloadUrl(fileId);

    return jsonResponse({
      fileId,
      url: driveProxyUrl,
      driveProxyUrl,
      publishUrl,
      mimeType: driveFile.mimeType || mimeType,
      size: Number(driveFile.size || file.size),
      driveFileName,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown server error";
    const sanitized = sanitizeUnknownUploadError(err);
    console.error("[proxy-upload] Error:", message);
    if (authContext) {
      await notifyUploadFailure({
        source: "server",
        phase: "proxy_upload_route",
        route: "/api/drive/proxy-upload",
        uploadPath: "proxy",
        workspaceId: authContext.workspaceId,
        userId: authContext.user.id,
        userEmail: authContext.email,
        userRole: authContext.role,
        folder,
        fileName,
        mimeType,
        fileSize,
        errorMessage: sanitized.error,
        errorStatus: statusForSanitizedDriveError(sanitized),
        errorDetail: message,
        userAgent: request.headers.get("user-agent"),
        ip: getClientIp(request),
        requestUrl: request.url,
      });
    }
    // Return clean error — never include raw stack traces or Google API responses
    return jsonResponse(sanitized, statusForSanitizedDriveError(sanitized));
  }
}
