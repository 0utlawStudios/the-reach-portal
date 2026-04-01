import { NextRequest, NextResponse } from "next/server";
import {
  getRootFolderId,
  ensureSubfolder,
  createResumableUploadSession,
} from "@/lib/google-drive";

export const maxDuration = 10;

const VALID_FOLDERS = ["thumbnails", "raw-files", "media-library"] as const;
type FolderName = (typeof VALID_FOLDERS)[number];

interface UploadRequest {
  fileName: string;
  mimeType: string;
  folder: FolderName;
  cardId?: string;
}

export async function POST(request: NextRequest) {
  try {
    const body: UploadRequest = await request.json();

    if (!body.fileName || !body.mimeType || !body.folder) {
      return NextResponse.json(
        { error: "Missing required fields: fileName, mimeType, folder" },
        { status: 400 }
      );
    }
    if (!VALID_FOLDERS.includes(body.folder)) {
      return NextResponse.json(
        { error: `Invalid folder. Must be one of: ${VALID_FOLDERS.join(", ")}` },
        { status: 400 }
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
      body.mimeType,
      parentId
    );

    const isImage = body.mimeType.startsWith("image/");

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
