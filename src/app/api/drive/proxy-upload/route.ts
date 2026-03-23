import { NextRequest } from "next/server";
import {
  getRootFolderId,
  ensureSubfolder,
  setPublicPermission,
  getAccessToken,
} from "@/lib/google-drive";

export const maxDuration = 60;

const VALID_FOLDERS = ["thumbnails", "raw-files", "media-library"] as const;

// Helper: always return clean JSON (no control characters ever)
function jsonResponse(data: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const folder = formData.get("folder") as string;
    const cardId = formData.get("cardId") as string | null;
    const fileName = formData.get("fileName") as string || file?.name || "upload";
    const mimeType = formData.get("mimeType") as string || file?.type || "application/octet-stream";

    if (!file || !(file instanceof File)) {
      return jsonResponse({ error: "No file provided" }, 400);
    }
    if (!VALID_FOLDERS.includes(folder as typeof VALID_FOLDERS[number])) {
      return jsonResponse({ error: "Invalid folder" }, 400);
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

    // Upload to Google Drive using multipart upload
    const boundary = "ten80ten_" + Date.now();
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
        },
        body: multipartBody,
      }
    );

    if (!uploadRes.ok) {
      // Log the full error server-side, return clean message to client
      const rawErr = await uploadRes.text();
      console.error("[proxy-upload] Google Drive error:", uploadRes.status, rawErr);
      return jsonResponse({ error: `Google Drive rejected the upload (HTTP ${uploadRes.status}). Check that the service account has Content Manager access to the Shared Drive.` }, 500);
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

    return jsonResponse({
      fileId,
      url: `/api/drive/stream?id=${fileId}`,
      mimeType: driveFile.mimeType || mimeType,
      size: Number(driveFile.size || file.size),
      driveFileName,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown server error";
    console.error("[proxy-upload] Error:", message);
    // Return clean error — never include raw stack traces or Google API responses
    return jsonResponse({ error: message.slice(0, 200) }, 500);
  }
}
