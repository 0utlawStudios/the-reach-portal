import { google, drive_v3 } from "googleapis";

// ─── Singleton Drive client ───

let _drive: drive_v3.Drive | null = null;
let _auth: InstanceType<typeof google.auth.GoogleAuth> | null = null;

function getCredentials() {
  const b64 = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!b64) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON env var is not set");
  const json = Buffer.from(b64, "base64").toString("utf-8");
  return JSON.parse(json);
}

function getAuth() {
  if (!_auth) {
    _auth = new google.auth.GoogleAuth({
      credentials: getCredentials(),
      scopes: ["https://www.googleapis.com/auth/drive"],
    });
  }
  return _auth;
}

export function getDriveClient(): drive_v3.Drive {
  if (!_drive) {
    _drive = google.drive({ version: "v3", auth: getAuth() });
  }
  return _drive;
}

export function getRootFolderId(): string {
  const id = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID;
  if (!id) throw new Error("GOOGLE_DRIVE_ROOT_FOLDER_ID env var is not set");
  return id;
}

// ─── Subfolder cache (avoids repeated Drive lookups) ───

const folderCache = new Map<string, string>();

export async function ensureSubfolder(name: string, parentId: string): Promise<string> {
  const cacheKey = `${parentId}/${name}`;
  if (folderCache.has(cacheKey)) return folderCache.get(cacheKey)!;

  const drive = getDriveClient();

  // Check if folder already exists
  const res = await drive.files.list({
    q: `name='${name}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: "files(id)",
    spaces: "drive",
  });

  if (res.data.files && res.data.files.length > 0) {
    const id = res.data.files[0].id!;
    folderCache.set(cacheKey, id);
    return id;
  }

  // Create the subfolder
  const create = await drive.files.create({
    requestBody: {
      name,
      mimeType: "application/vnd.google-apps.folder",
      parents: [parentId],
    },
    fields: "id",
  });

  const id = create.data.id!;
  folderCache.set(cacheKey, id);
  return id;
}

// ─── Resumable upload session ───

export async function createResumableUploadSession(
  fileName: string,
  mimeType: string,
  parentFolderId: string
): Promise<{ uploadUri: string; fileId: string }> {
  const auth = getAuth();
  const token = await auth.getAccessToken();

  // Initiate resumable upload — metadata only
  const res = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: fileName,
        parents: [parentFolderId],
        mimeType,
      }),
    }
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to create resumable upload session: ${res.status} ${err}`);
  }

  const uploadUri = res.headers.get("location");
  if (!uploadUri) throw new Error("No upload URI in response headers");

  // Extract fileId from the response body
  const body = await res.json();
  const fileId = body.id as string;

  return { uploadUri, fileId };
}

// ─── Permissions ───

export async function setPublicPermission(fileId: string): Promise<void> {
  const drive = getDriveClient();
  await drive.permissions.create({
    fileId,
    requestBody: {
      role: "reader",
      type: "anyone",
    },
  });
}

// ─── Serving URLs ───

export function getImageUrl(fileId: string): string {
  return `https://lh3.googleusercontent.com/d/${fileId}=s0`;
}

export function getStreamUrl(fileId: string): string {
  return `/api/drive/stream?id=${fileId}`;
}

// ─── File metadata ───

export async function getFileMetadata(fileId: string) {
  const drive = getDriveClient();
  const res = await drive.files.get({
    fileId,
    fields: "id,name,mimeType,size",
  });
  return {
    id: res.data.id!,
    name: res.data.name!,
    mimeType: res.data.mimeType!,
    size: Number(res.data.size || 0),
  };
}

// ─── Auth token accessor (for streaming proxy) ───

export async function getAccessToken(): Promise<string> {
  const auth = getAuth();
  const token = await auth.getAccessToken();
  if (!token) throw new Error("Failed to get access token");
  return token;
}
