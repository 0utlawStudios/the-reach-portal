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
  isAllowedDriveMediaMime,
  MAX_DRIVE_MEDIA_FILE_SIZE,
  normalizeDriveMimeType,
  VALID_DRIVE_FOLDERS,
} from "@/lib/drive-policy";

export const maxDuration = 60;

interface UploadRequest {
  fileName: string;
  mimeType: string;
  folder: DriveFolderName;
  cardId?: string;
  fileSize?: number;
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireBearerTeamRole(request, ALLOWED_DRIVE_ROLES);
    if (auth instanceof NextResponse) return auth;
    const { user } = auth;

    // Rate-limit: 60 upload-session creations per minute per user.
    const rlKey = `user:${user.id}|ip:${getClientIp(request)}`;
    const rl = await consume("drive-upload:create", rlKey, 60, 60);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Too many uploads. Please slow down." },
        { status: 429 },
      );
    }

    const body: UploadRequest = await request.json();

    if (!body.fileName || !body.mimeType || !body.folder) {
      return NextResponse.json(
        { error: "Missing required fields: fileName, mimeType, folder" },
        { status: 400 }
      );
    }
    if (!VALID_DRIVE_FOLDERS.includes(body.folder)) {
      return NextResponse.json(
        { error: `Invalid folder. Must be one of: ${VALID_DRIVE_FOLDERS.join(", ")}` },
        { status: 400 }
      );
    }
    const mimeType = normalizeDriveMimeType(body.mimeType);
    if (!isAllowedDriveMediaMime(mimeType)) {
      return NextResponse.json({ error: "Unsupported media type" }, { status: 415 });
    }
    if (typeof body.fileSize === "number" && body.fileSize > MAX_DRIVE_MEDIA_FILE_SIZE) {
      return NextResponse.json(
        { error: `File exceeds ${MAX_DRIVE_MEDIA_FILE_SIZE / (1024 * 1024)}MB limit.` },
        { status: 413 },
      );
    }

    const rootId = getRootFolderId();
    const parentId = await ensureSubfolder(body.folder, rootId);

    // Human-readable filename: 2026-04-01_08-32-15_originalname.ext
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 19).replace("T", "_").replace(/:/g, "-");
    const safeName = body.fileName.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/_+/g, "_");
    const driveFileName = `${dateStr}_${safeName}`;

    // Create resumable upload session — fileId comes from PUT completion
    const { uploadUri } = await createResumableUploadSession(
      driveFileName,
      mimeType,
      parentId,
      body.fileSize,
    );

    const isImage = mimeType.startsWith("image/");

    return NextResponse.json({
      uploadUri,
      isImage,
      driveFileName,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[drive/upload]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
