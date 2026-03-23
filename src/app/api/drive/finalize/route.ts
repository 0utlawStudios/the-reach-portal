import { NextRequest, NextResponse } from "next/server";
import { setPublicPermission, getImageUrl, getStreamUrl, getFileMetadata } from "@/lib/google-drive";

export const maxDuration = 10;

export async function POST(request: NextRequest) {
  try {
    const { fileId } = await request.json();

    if (!fileId || typeof fileId !== "string") {
      return NextResponse.json({ error: "Missing fileId" }, { status: 400 });
    }

    // Set public permission so the file is servable
    await setPublicPermission(fileId);

    // Get file metadata to determine serving URL
    const meta = await getFileMetadata(fileId);
    const isImage = meta.mimeType.startsWith("image/");
    const isVideo = meta.mimeType.startsWith("video/");

    return NextResponse.json({
      fileId,
      imageUrl: isImage ? getImageUrl(fileId) : null,
      streamUrl: isVideo ? getStreamUrl(fileId) : null,
      url: isImage ? getImageUrl(fileId) : isVideo ? getStreamUrl(fileId) : `https://drive.google.com/uc?id=${fileId}`,
      mimeType: meta.mimeType,
      size: meta.size,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[drive/finalize]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
