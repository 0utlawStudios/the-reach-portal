import { NextRequest } from "next/server";
import {
  getRootFolderId,
  ensureSubfolder,
  getAccessToken,
  getStreamUrl,
  getPublishStreamUrl,
} from "@/lib/google-drive";
import { consume, getClientIp } from "@/lib/rate-limit";
import { requireBearerTeamRole } from "@/lib/auth/require";
import {
  ALLOWED_DRIVE_UPLOAD_ROLES,
  isAllowedDriveUploadForFolder,
  MAX_DRIVE_MEDIA_FILE_SIZE,
  MAX_DRIVE_PROXY_FILE_SIZE,
  normalizeDriveMimeType,
  VALID_DRIVE_FOLDERS,
} from "@/lib/drive-policy";
import { scheduleUploadFailureAlert } from "../upload-alert-scheduler";
import {
  appRateLimitError,
  sanitizeGoogleDriveError,
  sanitizedDriveErrorDetail,
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
    const auth = await requireBearerTeamRole(request, ALLOWED_DRIVE_UPLOAD_ROLES);
    if (auth instanceof Response) return auth;
    authContext = auth;
    const { user } = auth;

    // 60/min/user. The proxy path is the primary route for every file under 4 MB
    // (one round-trip per file), so a multi-file batch — e.g. a 26-photo upload —
    // must not trip the limit. Matches drive/upload's 60/min envelope.
    const rlKey = `user:${user.id}|ip:${getClientIp(request)}`;
    const rl = await consume("drive-proxy-upload:user", rlKey, 60, 60, { onError: "deny" });
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
    // Reject zero-byte uploads here too. The client guards this, but a direct API
    // call (e.g. a QA harness) could otherwise create a silent 0-byte "success"
    // file in Drive — exactly the orphan seen in media-library. /api/drive/upload
    // (resumable session) and /api/drive/finalize already reject size <= 0.
    if (file.size === 0) {
      return jsonResponse({ error: "Cannot upload an empty file." }, 400);
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
      appProperties: { workspaceId: authContext.workspaceId },
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
      const rawErr = await uploadRes.text();
      const sanitized = sanitizeGoogleDriveError(uploadRes.status, rawErr);
      const detail = sanitizedDriveErrorDetail(sanitized, uploadRes.status);
      console.error("[proxy-upload] Google Drive error:", detail);
      const auth = authContext;
      scheduleUploadFailureAlert("proxy-upload", {
        source: "server",
        phase: "proxy_drive_upload",
        route: "/api/drive/proxy-upload",
        uploadPath: "proxy",
        workspaceId: auth.workspaceId,
        userId: auth.user.id,
        userEmail: auth.email,
        userRole: auth.role,
        folder,
        fileName,
        mimeType,
        fileSize,
        errorStatus: uploadRes.status,
        errorMessage: sanitized.error,
        errorDetail: detail,
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

    const driveProxyUrl = getStreamUrl(fileId, authContext.workspaceId);
    const publishUrl = getPublishStreamUrl(fileId, authContext.workspaceId);

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
    const sanitized = sanitizeUnknownUploadError(err);
    const detail = sanitizedDriveErrorDetail(sanitized);
    console.error("[proxy-upload] Error:", detail);
    if (authContext) {
      const auth = authContext;
      scheduleUploadFailureAlert("proxy-upload", {
        source: "server",
        phase: "proxy_upload_route",
        route: "/api/drive/proxy-upload",
        uploadPath: "proxy",
        workspaceId: auth.workspaceId,
        userId: auth.user.id,
        userEmail: auth.email,
        userRole: auth.role,
        folder,
        fileName,
        mimeType,
        fileSize,
        errorMessage: sanitized.error,
        errorStatus: statusForSanitizedDriveError(sanitized),
        errorDetail: detail,
        userAgent: request.headers.get("user-agent"),
        ip: getClientIp(request),
        requestUrl: request.url,
      });
    }
    // Return clean error — never include raw stack traces or Google API responses
    return jsonResponse(sanitized, statusForSanitizedDriveError(sanitized));
  }
}
