import { NextRequest, NextResponse } from "next/server";
import { requireBearerTeamRole } from "@/lib/auth/require";
import { consume, getClientIp } from "@/lib/rate-limit";
import {
  ALLOWED_DRIVE_UPLOAD_ROLES,
  DRIVE_RESUMABLE_CHUNK_SIZE,
  isAllowedDriveUploadForFolder,
  MAX_DRIVE_MEDIA_FILE_SIZE,
  normalizeDriveMimeType,
  VALID_DRIVE_FOLDERS,
  type DriveFolderName,
} from "@/lib/drive-policy";
import { scheduleUploadFailureAlert } from "../upload-alert-scheduler";
import {
  appRateLimitError,
  sanitizeGoogleDriveError,
  sanitizedDriveErrorDetail,
  sanitizeUnknownUploadError,
  statusForSanitizedDriveError,
} from "@/lib/drive-errors";
import { verifyDriveUploadSessionToken } from "@/lib/drive-upload-session";

export const maxDuration = 60;

const CONTENT_RANGE_RE = /^bytes (\d+)-(\d+)\/(\d+)$/;

function jsonResponse(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

function parseContentRange(value: string | null) {
  const match = value?.match(CONTENT_RANGE_RE);
  if (!match) return null;
  const start = Number(match[1]);
  const end = Number(match[2]);
  const total = Number(match[3]);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || !Number.isSafeInteger(total)) return null;
  if (start < 0 || end < start || total <= 0 || end >= total) return null;
  return { start, end, total };
}

function validUploadUri(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return null;
    if (url.hostname !== "www.googleapis.com") return null;
    if (url.pathname !== "/upload/drive/v3/files") return null;
    if (url.searchParams.get("uploadType") !== "resumable") return null;
    if (!url.searchParams.get("upload_id")) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  let authContext: { user: { id: string }; email: string; role: string; workspaceId: string } | null = null;
  let fileName = "";
  let folder: DriveFolderName | null = null;
  let mimeType = "application/octet-stream";
  let fileSize = 0;

  try {
    const auth = await requireBearerTeamRole(request, ALLOWED_DRIVE_UPLOAD_ROLES);
    if (auth instanceof NextResponse) return auth;
    authContext = auth;
    const { user } = auth;

    // Chunked resumable uploads can legitimately create many requests per
    // large file. 240/min supports several 20MB videos without letting a tab
    // hammer this route indefinitely.
    const rlKey = `user:${user.id}|ip:${getClientIp(request)}`;
    const rl = await consume("drive-upload-chunk:user", rlKey, 240, 60, { onError: "deny" });
    if (!rl.allowed) {
      return jsonResponse(appRateLimitError(rl.resetAt), 429);
    }

    const uploadUri = validUploadUri(request.headers.get("x-upload-uri"));
    const uploadToken = request.headers.get("x-upload-token");
    fileName = request.headers.get("x-file-name") || "upload";
    const folderHeader = request.headers.get("x-drive-folder");
    folder = VALID_DRIVE_FOLDERS.includes(folderHeader as DriveFolderName)
      ? folderHeader as DriveFolderName
      : null;
    mimeType = normalizeDriveMimeType(request.headers.get("content-type"), fileName);
    const contentRange = parseContentRange(request.headers.get("content-range"));

    if (!uploadUri) return jsonResponse({ error: "Invalid upload session" }, 400);
    if (!folder) return jsonResponse({ error: "Invalid folder" }, 400);
    if (!contentRange) return jsonResponse({ error: "Invalid content range" }, 400);
    if (!isAllowedDriveUploadForFolder(folder, mimeType, fileName)) {
      return jsonResponse({ error: "Unsupported file type for this upload folder" }, 415);
    }
    if (contentRange.total > MAX_DRIVE_MEDIA_FILE_SIZE) {
      return jsonResponse({ error: `File exceeds ${MAX_DRIVE_MEDIA_FILE_SIZE / (1024 * 1024)}MB limit.` }, 413);
    }
    fileSize = contentRange.total;
    if (!verifyDriveUploadSessionToken(uploadToken, {
      uploadUri,
      workspaceId: authContext.workspaceId,
      userId: user.id,
      folder,
      fileName,
      mimeType,
      fileSize,
    })) {
      return jsonResponse({ error: "Upload session does not belong to this workspace" }, 403);
    }
    const chunk = Buffer.from(await request.arrayBuffer());
    const expectedLength = contentRange.end - contentRange.start + 1;
    if (chunk.length !== expectedLength) {
      return jsonResponse({ error: "Chunk size does not match content range" }, 400);
    }
    if (chunk.length <= 0 || chunk.length > DRIVE_RESUMABLE_CHUNK_SIZE) {
      return jsonResponse({ error: "Chunk is too large" }, 413);
    }

    const uploadController = new AbortController();
    const uploadTimer = setTimeout(() => uploadController.abort(), 45000);
    let uploadRes: Response;
    try {
      uploadRes = await fetch(uploadUri, {
        method: "PUT",
        headers: {
          "Content-Type": mimeType,
          "Content-Length": String(chunk.length),
          "Content-Range": `bytes ${contentRange.start}-${contentRange.end}/${contentRange.total}`,
        },
        body: chunk,
        signal: uploadController.signal,
      });
    } finally {
      clearTimeout(uploadTimer);
    }

    if (uploadRes.status === 308) {
      return jsonResponse({
        done: false,
        range: uploadRes.headers.get("range"),
      });
    }

    if (!uploadRes.ok) {
      const rawErr = await uploadRes.text();
      const sanitized = sanitizeGoogleDriveError(uploadRes.status, rawErr);
      const detail = sanitizedDriveErrorDetail(sanitized, uploadRes.status);
      console.error("[drive/upload-chunk] Google Drive error:", detail);
      const auth = authContext;
      scheduleUploadFailureAlert("drive/upload-chunk", {
        source: "server",
        phase: "resumable_chunk_upload",
        route: "/api/drive/upload-chunk",
        uploadPath: "resumable",
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
    if (!driveFile?.id) {
      return jsonResponse({ error: "Upload succeeded but Google did not return a file ID" }, 500);
    }

    return jsonResponse({
      done: true,
      fileId: driveFile.id,
      mimeType: driveFile.mimeType || mimeType,
      size: Number(driveFile.size || fileSize),
    });
  } catch (err: unknown) {
    const sanitized = sanitizeUnknownUploadError(err);
    const detail = sanitizedDriveErrorDetail(sanitized);
    console.error("[drive/upload-chunk]", detail);
    if (authContext) {
      const auth = authContext;
      scheduleUploadFailureAlert("drive/upload-chunk", {
        source: "server",
        phase: "resumable_chunk_route",
        route: "/api/drive/upload-chunk",
        uploadPath: "resumable",
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
    return jsonResponse(sanitized, statusForSanitizedDriveError(sanitized));
  }
}
