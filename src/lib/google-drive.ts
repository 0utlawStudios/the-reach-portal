import { GoogleAuth } from "google-auth-library";
import { createHmac, timingSafeEqual } from "node:crypto";
import { sanitizeGoogleDriveError, sanitizedDriveErrorDetail } from "@/lib/drive-errors";
import { getPublicDriveDownloadUrl } from "@/lib/drive-url-utils";

// ─── Drive API base URLs ───
const DRIVE_API = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD = "https://www.googleapis.com/upload/drive/v3";

// ─── Singleton auth client ───

let _auth: GoogleAuth | null = null;
let cachedAccessToken: { token: string; expiresAt: number } | null = null;
let accessTokenInFlight: Promise<string> | null = null;
const ACCESS_TOKEN_CACHE_TTL_MS = 50 * 60 * 1000;
const ACCESS_TOKEN_MINT_TIMEOUT_MS = 10_000;
const DRIVE_FETCH_TIMEOUT_MS = 45_000;

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
  if (cachedAccessToken && cachedAccessToken.expiresAt > Date.now()) {
    return cachedAccessToken.token;
  }
  if (accessTokenInFlight) return accessTokenInFlight;

  accessTokenInFlight = withTimeout(
    (async () => {
      const client = await getAuth().getClient();
      const res = await client.getAccessToken();
      const token = res?.token;
      if (!token) throw new Error("Failed to get access token");
      cachedAccessToken = { token, expiresAt: Date.now() + ACCESS_TOKEN_CACHE_TTL_MS };
      return token;
    })(),
    ACCESS_TOKEN_MINT_TIMEOUT_MS,
    new Error("Google Drive token mint timed out"),
  ).finally(() => {
    accessTokenInFlight = null;
  });

  return accessTokenInFlight;
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
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DRIVE_FETCH_TIMEOUT_MS);
  const clear = () => clearTimeout(timer);
  const readWithTimeout = async <T>(read: () => Promise<T>): Promise<T> => {
    try {
      return await read();
    } catch (err) {
      if (controller.signal.aborted) throw new Error("Google Drive request timed out");
      throw err;
    } finally {
      clear();
    }
  };
  try {
    const res = await fetch(url, { ...init, headers, signal: controller.signal });
    const readText = res.text.bind(res);
    const readJson = res.json.bind(res);
    Object.defineProperties(res, {
      text: { value: () => readWithTimeout(readText) },
      json: { value: () => readWithTimeout(readJson) },
    });
    return res;
  } catch (err) {
    clear();
    if (controller.signal.aborted) throw new Error("Google Drive request timed out");
    throw err;
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, error: Error): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(error), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// ─── Subfolder cache ───

// Folder cache + mutex: prevents duplicate folder creation on parallel requests
// Cache entries expire after 5 minutes to handle external folder deletion
const folderCache = new Map<string, { id: string; at: number }>();
const folderLocks = new Map<string, Promise<string>>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export async function ensureSubfolder(name: string, parentId: string): Promise<string> {
  const cacheKey = `${parentId}/${name}`;

  // Fast path: already resolved and not expired
  const cached = folderCache.get(cacheKey);
  if (cached && Date.now() - cached.at < CACHE_TTL) return cached.id;

  // Mutex: if another request is already creating this folder, wait for it
  if (folderLocks.has(cacheKey)) return folderLocks.get(cacheKey)!;

  const promise = (async () => {
    // Check if folder already exists on Drive
    const q = encodeURIComponent(
      `name='${name}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`
    );
    const listRes = await driveFetch(`${DRIVE_API}/files?q=${q}&fields=files(id)&spaces=drive&supportsAllDrives=true&includeItemsFromAllDrives=true`);
    if (!listRes.ok) {
      const err = await listRes.text();
      throw new Error(`Failed to list folders: ${sanitizedDriveErrorDetail(sanitizeGoogleDriveError(listRes.status, err), listRes.status)}`);
    }
    const listData = await listRes.json();

    if (listData.files && listData.files.length > 0) {
      const id = listData.files[0].id;
      folderCache.set(cacheKey, { id, at: Date.now() });
      return id;
    }

    // Create the subfolder (only one request will reach here per cacheKey)
    const createRes = await driveFetch(`${DRIVE_API}/files?supportsAllDrives=true`, {
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
      throw new Error(`Failed to create folder: ${sanitizedDriveErrorDetail(sanitizeGoogleDriveError(createRes.status, err), createRes.status)}`);
    }
    const createData = await createRes.json();
    const id = createData.id;
    folderCache.set(cacheKey, { id, at: Date.now() });
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
  parentFolderId: string,
  contentLength?: number,
  workspaceId?: string,
): Promise<{ uploadUri: string }> {
  // Standard Google resumable upload: single POST creates session + file in one call
  // The fileId is returned AFTER the client completes the PUT upload
  const res = await driveFetch(
    `${DRIVE_UPLOAD}/files?uploadType=resumable&supportsAllDrives=true`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Upload-Content-Type": mimeType,
        ...(contentLength !== undefined ? { "X-Upload-Content-Length": String(contentLength) } : {}),
      },
      body: JSON.stringify({
        name: fileName,
        parents: [parentFolderId],
        mimeType,
        ...(workspaceId ? { appProperties: { workspaceId } } : {}),
      }),
    }
  );

  if (!res.ok) {
    const rawErr = await res.text();
    const sanitized = sanitizeGoogleDriveError(res.status, rawErr);
    throw new Error(`Failed to create resumable session: ${sanitizedDriveErrorDetail(sanitized, res.status)}`);
  }

  const uploadUri = res.headers.get("location");
  if (!uploadUri) throw new Error("No upload URI in response headers");

  return { uploadUri };
}

// ─── Permissions ───

export async function setPublicPermission(fileId: string): Promise<void> {
  const res = await driveFetch(`${DRIVE_API}/files/${fileId}/permissions?supportsAllDrives=true`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role: "reader", type: "anyone" }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to set permission: ${sanitizedDriveErrorDetail(sanitizeGoogleDriveError(res.status, err), res.status)}`);
  }
}

// ─── Serving URLs ───

export function getImageUrl(fileId: string): string {
  return `https://lh3.googleusercontent.com/d/${fileId}=s0`;
}

export function getDriveDownloadUrl(fileId: string): string {
  return getPublicDriveDownloadUrl(fileId);
}

function streamSigningSecret(): string {
  const secret = process.env.DRIVE_STREAM_SIGNING_SECRET ||
    (process.env.NODE_ENV === "production" ? "" : process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  if (!secret) throw new Error("Drive stream signing secret is not configured");
  return secret;
}

const DRIVE_STREAM_TOKEN_VERSION = "v1";
const DRIVE_STREAM_TOKEN_VERSION_WITH_PURPOSE = "v2";
const DRIVE_STREAM_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const DRIVE_PUBLISH_STREAM_TOKEN_TTL_MS = 365 * 24 * 60 * 60 * 1000;
type DriveStreamTokenPurpose = "private" | "publish";

function appUrlOrigin(): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL || process.env.VERCEL_URL || "http://localhost:3000";
  const withProtocol = /^https?:\/\//i.test(configured) ? configured : `https://${configured}`;
  try {
    return new URL(withProtocol).origin;
  } catch {
    return "http://localhost:3000";
  }
}

function signDriveStreamPayload(fileId: string, workspaceId: string, expiresAt: number): string {
  return createHmac("sha256", streamSigningSecret())
    .update(`${fileId}.${workspaceId}.${expiresAt}`)
    .digest("base64url");
}

function signDriveStreamPayloadV2(fileId: string, workspaceId: string, expiresAt: number, purpose: DriveStreamTokenPurpose): string {
  return createHmac("sha256", streamSigningSecret())
    .update(`${fileId}.${workspaceId}.${expiresAt}.${purpose}`)
    .digest("base64url");
}

export function signDriveStreamToken(
  fileId: string,
  workspaceId: string,
  expiresAt = Date.now() + DRIVE_STREAM_TOKEN_TTL_MS,
  purpose: DriveStreamTokenPurpose = "private",
): string {
  const signature = signDriveStreamPayloadV2(fileId, workspaceId, expiresAt, purpose);
  return `${DRIVE_STREAM_TOKEN_VERSION_WITH_PURPOSE}.${expiresAt}.${workspaceId}.${purpose}.${signature}`;
}

export function verifyDriveStreamToken(
  fileId: string,
  token: string | null | undefined,
): { workspaceId: string; expiresAt: number; purpose: DriveStreamTokenPurpose } | null {
  if (!token) return null;
  try {
    const [version, expiresAtRaw, workspaceId, maybePurpose, maybeSignature] = token.split(".");
    if (!expiresAtRaw || !workspaceId || !maybePurpose) return null;
    const expiresAt = Number(expiresAtRaw);
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return null;
    if (version === DRIVE_STREAM_TOKEN_VERSION_WITH_PURPOSE) {
      const purpose = maybePurpose as DriveStreamTokenPurpose;
      const signature = maybeSignature;
      if ((purpose !== "private" && purpose !== "publish") || !signature) return null;
      const expectedV2 = signDriveStreamPayloadV2(fileId, workspaceId, expiresAt, purpose);
      const aV2 = Buffer.from(expectedV2);
      const bV2 = Buffer.from(signature);
      if (aV2.length !== bV2.length || !timingSafeEqual(aV2, bV2)) return null;
      return { workspaceId, expiresAt, purpose };
    }

    if (version !== DRIVE_STREAM_TOKEN_VERSION) return null;
    const signature = maybePurpose;
    const expected = signDriveStreamPayload(fileId, workspaceId, expiresAt);
    const a = Buffer.from(expected);
    const b = Buffer.from(signature);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    // Legacy v1 tokens did not encode purpose. Private app URLs were minted for
    // 24h, while publish URLs were minted for one year. Keep long-lived legacy
    // publish links working, but reject the short private tokens if copied.
    return {
      workspaceId,
      expiresAt,
      purpose: expiresAt - Date.now() > DRIVE_STREAM_TOKEN_TTL_MS ? "publish" : "private",
    };
  } catch {
    return null;
  }
}

export function getStreamUrl(
  fileId: string,
  workspaceId: string,
): string {
  void workspaceId;
  const params = new URLSearchParams({ id: fileId });
  return `/api/drive/stream?${params.toString()}`;
}

export function getPublishStreamUrl(fileId: string, workspaceId: string): string {
  const expiresAt = Date.now() + DRIVE_PUBLISH_STREAM_TOKEN_TTL_MS;
  const params = new URLSearchParams({
    id: fileId,
    token: signDriveStreamToken(fileId, workspaceId, expiresAt, "publish"),
  });
  return `${appUrlOrigin()}/api/drive/stream?${params.toString()}`;
}

// ─── File metadata ───

export async function getFileMetadata(fileId: string) {
  const res = await driveFetch(`${DRIVE_API}/files/${fileId}?fields=id,name,mimeType,size,parents,appProperties,thumbnailLink&supportsAllDrives=true`);
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to get file metadata: ${sanitizedDriveErrorDetail(sanitizeGoogleDriveError(res.status, err), res.status)}`);
  }
  const data = await res.json();
  return {
    id: data.id as string,
    name: data.name as string,
    mimeType: data.mimeType as string,
    size: Number(data.size || 0),
    parents: Array.isArray(data.parents) ? data.parents as string[] : [],
    appProperties: data.appProperties && typeof data.appProperties === "object"
      ? data.appProperties as Record<string, string>
      : {},
    thumbnailLink: typeof data.thumbnailLink === "string" ? data.thumbnailLink : "",
  };
}
