import { NextRequest, NextResponse } from "next/server";
import {
  getRootFolderId,
  ensureSubfolder,
  createResumableUploadSession,
  setPublicPermission,
  getImageUrl,
  getStreamUrl,
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

    // Validate
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

    // Resolve the subfolder inside the root Drive folder
    const rootId = getRootFolderId();
    const parentId = await ensureSubfolder(body.folder, rootId);

    // Build a descriptive file name
    const prefix = body.cardId ? `${body.cardId}-` : "";
    const timestamp = Date.now();
    const ext = body.fileName.split(".").pop() || "";
    const driveFileName = `${prefix}${timestamp}.${ext}`;

    // Create the resumable upload session
    const { uploadUri, fileId } = await createResumableUploadSession(
      driveFileName,
      body.mimeType,
      parentId
    );

    // Set public permission so the file is servable
    await setPublicPermission(fileId);

    // Compute serving URLs based on media type
    const isImage = body.mimeType.startsWith("image/");
    const isVideo = body.mimeType.startsWith("video/");

    return NextResponse.json({
      uploadUri,
      fileId,
      imageUrl: isImage ? getImageUrl(fileId) : null,
      streamUrl: isVideo ? getStreamUrl(fileId) : null,
      driveFileName,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[drive/upload]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
