import { NextRequest, NextResponse } from "next/server";
import {
  getRootFolderId,
  ensureSubfolder,
  setPublicPermission,
  getAccessToken,
  getFileMetadata,
} from "@/lib/google-drive";

export const maxDuration = 60; // Fluid Compute for large files

const VALID_FOLDERS = ["thumbnails", "raw-files", "media-library"] as const;

// Single API route: receives file, uploads to Google Drive, returns fileId + URL
// Eliminates CORS issues by keeping everything server-side
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const folder = formData.get("folder") as string;
    const cardId = formData.get("cardId") as string | null;
    const fileName = formData.get("fileName") as string || file?.name || "upload";
    const mimeType = formData.get("mimeType") as string || file?.type || "application/octet-stream";

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }
    if (!VALID_FOLDERS.includes(folder as typeof VALID_FOLDERS[number])) {
      return NextResponse.json({ error: `Invalid folder: ${folder}` }, { status: 400 });
    }

    // Resolve subfolder
    const rootId = getRootFolderId();
    const parentId = await ensureSubfolder(folder, rootId);

    // Build filename
    const prefix = cardId ? `${cardId}-` : "";
    const timestamp = Date.now();
    const ext = fileName.split(".").pop() || "";
    const driveFileName = `${prefix}${timestamp}.${ext}`;

    // Get auth token
    const token = await getAccessToken();

    // Upload to Google Drive using multipart upload (metadata + file in one request)
    const boundary = "ten80ten_boundary_" + Date.now();
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
          "Content-Length": multipartBody.length.toString(),
        },
        body: multipartBody,
      }
    );

    if (!uploadRes.ok) {
      const rawErr = await uploadRes.text();
      // Sanitize: Google API errors contain newlines that break downstream JSON parsing
      const cleanErr = rawErr.replace(/[\x00-\x1F\x7F]/g, " ").slice(0, 200);
      return NextResponse.json({ error: `Drive upload failed (${uploadRes.status}): ${cleanErr}` }, { status: 500 });
    }

    const driveFile = await uploadRes.json();
    const fileId = driveFile.id;

    // Set public permission
    await setPublicPermission(fileId);

    // Get serving URL via stream proxy
    const streamUrl = `/api/drive/stream?id=${fileId}`;

    return NextResponse.json({
      fileId,
      url: streamUrl,
      mimeType: driveFile.mimeType || mimeType,
      size: Number(driveFile.size || file.size),
      driveFileName,
    });
  } catch (err: unknown) {
    const message = (err instanceof Error ? err.message : "Unknown error").replace(/[\x00-\x1F\x7F]/g, " ");
    console.error("[drive/proxy-upload]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
