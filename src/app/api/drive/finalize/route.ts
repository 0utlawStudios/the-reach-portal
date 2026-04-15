import { NextRequest, NextResponse } from "next/server";
import { setPublicPermission, getStreamUrl, getFileMetadata } from "@/lib/google-drive";

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

    // Always use our stream proxy as primary URL — it's authenticated server-side
    // and works immediately (lh3 URLs break during Google permission propagation)
    const proxyUrl = getStreamUrl(fileId);

    return NextResponse.json({
      fileId,
      imageUrl: isImage ? proxyUrl : null,
      streamUrl: isVideo ? proxyUrl : null,
      url: proxyUrl,
      mimeType: meta.mimeType,
      size: meta.size,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[drive/finalize]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
