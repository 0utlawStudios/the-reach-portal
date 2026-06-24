import { NextRequest, NextResponse } from "next/server";
import {
  getRootFolderId,
  ensureSubfolder,
  createResumableUploadSession,
} from "@/lib/google-drive";
import { consume, getClientIp } from "@/lib/rate-limit";
import { requireBearerTeamRole } from "@/lib/auth/require";
import {
  ALLOWED_DRIVE_ROLES,
  DriveFolderName,
  isAllowedDriveUploadForFolder,
  MAX_DRIVE_MEDIA_FILE_SIZE,
  normalizeDriveMimeType,
  VALID_DRIVE_FOLDERS,
} from "@/lib/drive-policy";
import { notifyUploadFailure } from "@/lib/upload-alerts";
import {
  appRateLimitError,
  sanitizeUnknownUploadError,
  statusForSanitizedDriveError,
} from "@/lib/drive-errors";

export const maxDuration = 60;

interface UploadRequest {
  fileName: string;
  mimeType: string;
  folder: DriveFolderName;
  cardId?: string;
  fileSize?: number;
}

export async function POST(request: NextRequest) {
  let authContext: { user: { id: string }; email: string; role: string; workspaceId: string } | null = null;
  let body: Partial<UploadRequest> | null = null;
  let folder: DriveFolderName | null = null;
  let fileName: string | null = null;
  let mimeType = "application/octet-stream";
  let fileSize: number | null = null;
  try {
    const auth = await requireBearerTeamRole(request, ALLOWED_DRIVE_ROLES);
    if (auth instanceof NextResponse) return auth;
    authContext = auth;
    const { user } = auth;

    // Rate-limit: 60 upload-session creations per minute per user.
    const rlKey = `user:${user.id}|ip:${getClientIp(request)}`;
    const rl = await consume("drive-upload:create", rlKey, 60, 60);
    if (!rl.allowed) {
      const limited = appRateLimitError(rl.resetAt);
      return NextResponse.json(
        limited,
        { status: 429 },
      );
    }

    body = await request.json();

    const uploadRequest = body;
    if (!uploadRequest?.fileName || !uploadRequest.mimeType || !uploadRequest.folder) {
      return NextResponse.json(
        { error: "Missing required fields: fileName, mimeType, folder" },
        { status: 400 }
      );
    }
    folder = uploadRequest.folder;
    fileName = uploadRequest.fileName;
    if (!VALID_DRIVE_FOLDERS.includes(folder)) {
      return NextResponse.json(
        { error: `Invalid folder. Must be one of: ${VALID_DRIVE_FOLDERS.join(", ")}` },
        { status: 400 }
      );
    }
    const requestedSize = Number(uploadRequest.fileSize);
    if (!Number.isFinite(requestedSize) || requestedSize <= 0) {
      return NextResponse.json(
        { error: "Missing or invalid fileSize" },
        { status: 400 },
      );
    }
    fileSize = requestedSize;
    mimeType = normalizeDriveMimeType(uploadRequest.mimeType, fileName);
    if (!isAllowedDriveUploadForFolder(folder, mimeType, fileName)) {
      return NextResponse.json({ error: "Unsupported file type for this upload folder" }, { status: 415 });
    }
    if (fileSize > MAX_DRIVE_MEDIA_FILE_SIZE) {
      return NextResponse.json(
        { error: `File exceeds ${MAX_DRIVE_MEDIA_FILE_SIZE / (1024 * 1024)}MB limit.` },
        { status: 413 },
      );
    }

    const rootId = getRootFolderId();
    const parentId = await ensureSubfolder(folder, rootId);

    // Human-readable filename: 2026-04-01_08-32-15_originalname.ext
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 19).replace("T", "_").replace(/:/g, "-");
    const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/_+/g, "_");
    const driveFileName = `${dateStr}_${safeName}`;

    // Create resumable upload session — fileId comes from PUT completion
    const { uploadUri } = await createResumableUploadSession(
      driveFileName,
      mimeType,
      parentId,
      fileSize,
      authContext.workspaceId,
    );

    const isImage = mimeType.startsWith("image/");

    return NextResponse.json({
      uploadUri,
      isImage,
      driveFileName,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    const sanitized = sanitizeUnknownUploadError(err);
    console.error("[drive/upload]", message);
    if (authContext) {
      await notifyUploadFailure({
        source: "server",
        phase: "resumable_session",
        route: "/api/drive/upload",
        uploadPath: "resumable",
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
    return NextResponse.json(sanitized, { status: statusForSanitizedDriveError(sanitized) });
  }
}
