import { GoogleAuth } from "google-auth-library";

// ─── Drive API base URLs ───
const DRIVE_API = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD = "https://www.googleapis.com/upload/drive/v3";

// ─── Singleton auth client ───

let _auth: GoogleAuth | null = null;

function getCredentials() {
  const b64 = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!b64) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON env var is not set");
  const json = Buffer.from(b64, "base64").toString("utf-8");
  return JSON.parse(json);
}

function getAuth(): GoogleAuth {
  if (!_auth) {
    _auth = new GoogleAuth({
      credentials: getCredentials(),
      scopes: ["https://www.googleapis.com/auth/drive"],
    });
  }
  return _auth;
}

export async function getAccessToken(): Promise<string> {
  const client = await getAuth().getClient();
  const res = await client.getAccessToken();
  const token = res?.token;
  if (!token) throw new Error("Failed to get access token");
  return token;
}

export function getRootFolderId(): string {
  const id = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID;
  if (!id) throw new Error("GOOGLE_DRIVE_ROOT_FOLDER_ID env var is not set");
  return id;
}

// ─── Authenticated fetch helper ───

async function driveFetch(url: string, init?: RequestInit): Promise<Response> {
  const token = await getAccessToken();
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${token}`);
  return fetch(url, { ...init, headers });
}

// ─── Subfolder cache ───

// Folder cache + mutex: prevents duplicate folder creation on parallel requests
const folderCache = new Map<string, string>();
const folderLocks = new Map<string, Promise<string>>();

export async function ensureSubfolder(name: string, parentId: string): Promise<string> {
  const cacheKey = `${parentId}/${name}`;

  // Fast path: already resolved
  if (folderCache.has(cacheKey)) return folderCache.get(cacheKey)!;

  // Mutex: if another request is already creating this folder, wait for it
  if (folderLocks.has(cacheKey)) return folderLocks.get(cacheKey)!;

  const promise = (async () => {
    // Check if folder already exists on Drive
    const q = encodeURIComponent(
      `name='${name}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`
    );
    const listRes = await driveFetch(`${DRIVE_API}/files?q=${q}&fields=files(id)&spaces=drive`);
    if (!listRes.ok) {
      const err = await listRes.text();
      throw new Error(`Failed to list folders: ${listRes.status} ${err}`);
    }
    const listData = await listRes.json();

    if (listData.files && listData.files.length > 0) {
      const id = listData.files[0].id;
      folderCache.set(cacheKey, id);
      return id;
    }

    // Create the subfolder (only one request will reach here per cacheKey)
    const createRes = await driveFetch(`${DRIVE_API}/files`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        mimeType: "application/vnd.google-apps.folder",
        parents: [parentId],
      }),
    });
    if (!createRes.ok) {
      const err = await createRes.text();
      throw new Error(`Failed to create folder: ${createRes.status} ${err}`);
    }
    const createData = await createRes.json();
    const id = createData.id;
    folderCache.set(cacheKey, id);
    return id;
  })();

  // Store the pending promise so parallel callers wait on it
  folderLocks.set(cacheKey, promise);
  try {
    return await promise;
  } finally {
    folderLocks.delete(cacheKey);
  }
}

// ─── Resumable upload session ───

export async function createResumableUploadSession(
  fileName: string,
  mimeType: string,
  parentFolderId: string
): Promise<{ uploadUri: string }> {
  // Standard Google resumable upload: single POST creates session + file in one call
  // The fileId is returned AFTER the client completes the PUT upload
  const res = await driveFetch(
    `${DRIVE_UPLOAD}/files?uploadType=resumable`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Upload-Content-Type": mimeType,
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
    throw new Error(`Failed to create resumable session: ${res.status} ${err}`);
  }

  const uploadUri = res.headers.get("location");
  if (!uploadUri) throw new Error("No upload URI in response headers");

  return { uploadUri };
}

// ─── Permissions ───

export async function setPublicPermission(fileId: string): Promise<void> {
  const res = await driveFetch(`${DRIVE_API}/files/${fileId}/permissions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role: "reader", type: "anyone" }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to set permission: ${res.status} ${err}`);
  }
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
  const res = await driveFetch(`${DRIVE_API}/files/${fileId}?fields=id,name,mimeType,size`);
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to get file metadata: ${res.status} ${err}`);
  }
  const data = await res.json();
  return {
    id: data.id as string,
    name: data.name as string,
    mimeType: data.mimeType as string,
    size: Number(data.size || 0),
  };
}
