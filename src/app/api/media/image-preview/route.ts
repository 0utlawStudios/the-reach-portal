import sharp from "sharp";
import decodeHeic from "heic-decode";
import { after, NextRequest, NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  ensureSubfolder,
  getAccessToken,
  getFileMetadata,
  getRootFolderId,
  verifyDriveStreamToken,
} from "@/lib/google-drive";
import { ALLOWED_DRIVE_ROLES, normalizeDriveMimeType, VALID_DRIVE_FOLDERS } from "@/lib/drive-policy";
import { sanitizedDriveErrorDetail, sanitizeUnknownUploadError, statusForSanitizedDriveError } from "@/lib/drive-errors";
import { requireBearerTeamRole, requireRole, requireUser, type WorkspaceRole } from "@/lib/auth/require";
import { withStorageControlTimeout } from "@/lib/storage-upload-timeout";
import { isKnownAppDriveFile } from "@/lib/media-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const DRIVE_FILE_ID_RE = /^[a-zA-Z0-9_-]{20,80}$/;
const HEIC_IMAGE_MIME_TYPES = new Set(["image/heic", "image/heic-sequence", "image/heif", "image/heif-sequence"]);
const BROWSER_SAFE_IMAGE_MIME_TYPES = new Set([
  "image/avif",
  "image/bmp",
  "image/gif",
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/tiff",
  "image/webp",
]);
const MAX_PREVIEW_SOURCE_BYTES = 50 * 1024 * 1024;
const PREVIEW_CACHE_BUCKET = "media-thumbnails";
const PREVIEW_CACHE_READ_TIMEOUT_MS = 2_000;
const PREVIEW_CACHE_WRITE_TIMEOUT_MS = 5_000;
const PREVIEW_SIZES = {
  thumb: { maxEdge: 520, quality: 78 },
  full: { maxEdge: 1600, quality: 86 },
} as const;
const PREVIEW_CONVERSION_TIMEOUT_MS = {
  thumb: 8_000,
  full: 25_000,
} as const;
// heic-decode allocates raw RGBA in JS/WASM before Sharp can resize it. Cap the
// fallback below Sharp's native limit so common 48MP iPhone HEICs still preview
// while larger panoramas fail closed before raw decode.
const HEIC_FALLBACK_MAX_PIXELS = 50_000_000;
const DRIVE_MEDIA_TIMEOUT_MS = 45_000;
const DRIVE_THUMBNAIL_TIMEOUT_MS = 2_500;
// Drive often has a browser-safe thumbnail for iPhone HEICs, but it can take
// longer than one RTT to return. Waiting through the thumbnail fetch budget is
// still far cheaper than falling back to full HEIC decode, which is the source
// of the several-second black preview users see on cold files.
const PREVIEW_FAST_THUMBNAIL_LOOKUP_TIMEOUT_MS = 3_000;
const MAX_DRIVE_THUMBNAIL_BYTES = 5 * 1024 * 1024;
const inFlightPreviewBuilds = new Map<string, Promise<Buffer>>();

type PreviewSize = keyof typeof PREVIEW_SIZES;
type PreviewCacheFamily = "heic-previews" | "image-previews";

type HeicDecodedImage = {
  width: number;
  height: number;
  data: Uint8ClampedArray | Uint8Array;
};

type PreviewCandidate = {
  preview: Buffer;
  cacheState: "HIT" | "MISS";
  writeCacheKey?: string;
};

class ImagePreviewHttpError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ImagePreviewHttpError";
    this.status = status;
  }
}

function browserSafeJpegResponse(
  preview: Buffer,
  cacheScope: "private" | "publish",
  size: PreviewSize,
  cacheState: "HIT" | "MISS" | "BYPASS" = "BYPASS",
) {
  const responseBody = preview.buffer.slice(preview.byteOffset, preview.byteOffset + preview.byteLength) as ArrayBuffer;
  const cacheControl = cacheScope === "publish"
    ? "public, max-age=86400, immutable"
    : "private, max-age=86400, immutable";

  return new Response(responseBody, {
    status: 200,
    headers: {
      "Content-Type": "image/jpeg",
      "Content-Length": String(preview.length),
      "Cache-Control": cacheControl,
      "X-Content-Type-Options": "nosniff",
      "X-Preview-Cache": cacheState,
      "X-Preview-Size": size,
    },
  });
}

function isHeicPreviewMime(mimeType: string, extensionMimeType: string): boolean {
  return HEIC_IMAGE_MIME_TYPES.has(mimeType) || HEIC_IMAGE_MIME_TYPES.has(extensionMimeType);
}

function isBrowserSafeThumbnailMime(mimeType: string, extensionMimeType: string): boolean {
  return BROWSER_SAFE_IMAGE_MIME_TYPES.has(mimeType) || BROWSER_SAFE_IMAGE_MIME_TYPES.has(extensionMimeType);
}

function previewCacheKey(
  fileId: string,
  workspaceId: string | undefined,
  size: PreviewSize,
  family: PreviewCacheFamily = "heic-previews",
): string {
  const namespace = (workspaceId || "legacy").replace(/[^a-zA-Z0-9_-]/g, "_");
  return `${namespace}/${family}/${size}/${fileId}.jpg`;
}

function legacyPreviewCacheKey(fileId: string, workspaceId?: string): string {
  const namespace = (workspaceId || "legacy").replace(/[^a-zA-Z0-9_-]/g, "_");
  return `${namespace}/heic-previews/${fileId}.jpg`;
}

function previewSizeFromRequest(req: NextRequest): PreviewSize {
  return req.nextUrl.searchParams.get("size") === "thumb" ? "thumb" : "full";
}

async function readCachedPreview(admin: SupabaseClient | null, key: string): Promise<Buffer | null> {
  if (!admin) return null;
  try {
    const { data, error } = await withStorageControlTimeout(
      admin.storage.from(PREVIEW_CACHE_BUCKET).download(key),
      "HEIC preview cache read",
      PREVIEW_CACHE_READ_TIMEOUT_MS,
    );
    if (error || !data) return null;
    return Buffer.from(await data.arrayBuffer());
  } catch (err) {
    console.warn("[media/image-preview] preview cache read skipped:", err instanceof Error ? err.message : err);
    return null;
  }
}

async function writeCachedPreview(admin: SupabaseClient | null, key: string, preview: Buffer): Promise<void> {
  if (!admin) return;
  try {
    const { error } = await withStorageControlTimeout(
      admin.storage.from(PREVIEW_CACHE_BUCKET).upload(key, preview, {
        contentType: "image/jpeg",
        cacheControl: "31536000",
        upsert: true,
      }),
      "HEIC preview cache write",
      PREVIEW_CACHE_WRITE_TIMEOUT_MS,
    );
    if (error) {
      console.warn("[media/image-preview] preview cache write failed:", error.message);
    }
  } catch (err) {
    console.warn("[media/image-preview] preview cache write skipped:", err instanceof Error ? err.message : err);
  }
}

function schedulePreviewCacheWrite(admin: SupabaseClient | null, key: string, preview: Buffer) {
  if (!admin) return;
  try {
    after(() => writeCachedPreview(admin, key, preview));
  } catch {
    // Vitest and some self-hosted contexts do not provide Next's request scope.
    // Production Vercel/Next uses `after`; this fallback keeps preview delivery
    // working where only a normal Node event loop is available.
    void writeCachedPreview(admin, key, preview);
  }
}

function resizeBrowserSafeJpeg(source: Buffer, size: PreviewSize) {
  const preview = PREVIEW_SIZES[size];
  return sharp(source, { limitInputPixels: HEIC_FALLBACK_MAX_PIXELS })
    .rotate()
    .resize({
      width: preview.maxEdge,
      height: preview.maxEdge,
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality: preview.quality, mozjpeg: true })
    .toBuffer();
}

async function buildThumbnailFromCachedPreview(admin: SupabaseClient | null, fileId: string, workspaceId?: string): Promise<Buffer | null> {
  const cachedFull =
    await readCachedPreview(admin, previewCacheKey(fileId, workspaceId, "full")) ||
    await readCachedPreview(admin, legacyPreviewCacheKey(fileId, workspaceId));
  if (!cachedFull) return null;

  try {
    return await withPreviewTimeout(
      resizeBrowserSafeJpeg(cachedFull, "thumb"),
      PREVIEW_CONVERSION_TIMEOUT_MS.thumb,
      "HEIC thumbnail cache resize",
    );
  } catch (err) {
    console.warn("[media/image-preview] cached full preview could not be resized:", err instanceof Error ? err.message : err);
    return null;
  }
}

async function withPreviewTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new ImagePreviewHttpError(`${label} timed out`, 504)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function withNullTimeout<T>(promise: Promise<T | null>, timeoutMs: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function firstAvailablePreview(candidates: Promise<PreviewCandidate | null>[]): Promise<PreviewCandidate | null> {
  if (candidates.length === 0) return null;
  return new Promise((resolve) => {
    let pending = candidates.length;
    let settled = false;

    const finishEmpty = () => {
      pending -= 1;
      if (!settled && pending === 0) {
        settled = true;
        resolve(null);
      }
    };

    for (const candidate of candidates) {
      candidate
        .then((result) => {
          if (settled) return;
          if (result) {
            settled = true;
            resolve(result);
            return;
          }
          finishEmpty();
        })
        .catch(() => {
          if (!settled) finishEmpty();
        });
    }
  });
}

function assertFallbackPixelSafe(width: number, height: number) {
  const pixels = width * height;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0 || pixels > HEIC_FALLBACK_MAX_PIXELS) {
    throw new ImagePreviewHttpError("Image is too large for preview conversion", 413);
  }
}

function resizeRawBrowserSafeJpeg(image: HeicDecodedImage, size: PreviewSize) {
  assertFallbackPixelSafe(image.width, image.height);
  const preview = PREVIEW_SIZES[size];
  return sharp(image.data, {
    raw: {
      width: image.width,
      height: image.height,
      channels: 4,
    },
    limitInputPixels: HEIC_FALLBACK_MAX_PIXELS,
  })
    .resize({
      width: preview.maxEdge,
      height: preview.maxEdge,
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality: preview.quality, mozjpeg: true })
    .toBuffer();
}

async function convertHeicWithFallbackDecoder(source: Buffer, size: PreviewSize) {
  const images = await withPreviewTimeout(
    decodeHeic.all({ buffer: source }),
    PREVIEW_CONVERSION_TIMEOUT_MS[size],
    "HEIC preview conversion",
  );
  try {
    const image = images[0];
    if (!image) throw new Error("HEIF image not found");
    assertFallbackPixelSafe(image.width, image.height);
    const decoded = await withPreviewTimeout(
      image.decode(),
      PREVIEW_CONVERSION_TIMEOUT_MS[size],
      "HEIC preview conversion",
    );
    return withPreviewTimeout(
      resizeRawBrowserSafeJpeg(decoded, size),
      PREVIEW_CONVERSION_TIMEOUT_MS[size],
      "HEIC preview conversion",
    );
  } finally {
    try {
      images.dispose();
    } catch {
      // Best-effort cleanup only; preserve the conversion error if one exists.
    }
  }
}

async function buildHeicPreview(source: Buffer, size: PreviewSize) {
  if (sharp.format.heif?.input.buffer) {
    try {
      return await withPreviewTimeout(
        resizeBrowserSafeJpeg(source, size),
        PREVIEW_CONVERSION_TIMEOUT_MS[size],
        "HEIC preview conversion",
      );
    } catch (err) {
      if (err instanceof ImagePreviewHttpError) throw err;
      // Some runtimes expose HEIF metadata support but cannot decode iPhone HEVC HEIC payloads.
    }
  }

  return convertHeicWithFallbackDecoder(source, size);
}

async function fetchDriveThumbnail(thumbnailLink: string | undefined, accessToken: string): Promise<Buffer | null> {
  if (!thumbnailLink) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DRIVE_THUMBNAIL_TIMEOUT_MS);
  try {
    const res = await fetch(thumbnailLink, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const contentType = (res.headers.get("content-type") || "").toLowerCase();
    if (!contentType.startsWith("image/") || contentType.includes("svg") || contentType.includes("heic") || contentType.includes("heif")) return null;
    const thumbnail = Buffer.from(await res.arrayBuffer());
    if (thumbnail.length <= 0 || thumbnail.length > MAX_DRIVE_THUMBNAIL_BYTES) return null;
    if (contentType.includes("image/jpeg") || contentType.includes("image/jpg")) return thumbnail;
    return await withPreviewTimeout(
      resizeBrowserSafeJpeg(thumbnail, "thumb"),
      PREVIEW_CONVERSION_TIMEOUT_MS.thumb,
      "Drive thumbnail normalization",
    );
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function buildPreviewOnce(cacheKey: string, build: () => Promise<Buffer>): Promise<Buffer> {
  const existing = inFlightPreviewBuilds.get(cacheKey);
  if (existing) return existing;

  const pending = build().finally(() => {
    inFlightPreviewBuilds.delete(cacheKey);
  });
  inFlightPreviewBuilds.set(cacheKey, pending);
  return pending;
}

function serviceRoleClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function isInAppManagedDriveFolder(fileId: string): Promise<boolean> {
  try {
    const [meta, rootId] = await Promise.all([getFileMetadata(fileId), Promise.resolve(getRootFolderId())]);
    const allowedParentIds = await Promise.all(VALID_DRIVE_FOLDERS.map((folder) => ensureSubfolder(folder, rootId)));
    return meta.parents.some((parentId) => allowedParentIds.includes(parentId));
  } catch {
    return false;
  }
}

async function metadataIsInAppManagedDriveFolder(meta: { parents: string[] }): Promise<boolean> {
  try {
    const rootId = getRootFolderId();
    const allowedParentIds = await Promise.all(VALID_DRIVE_FOLDERS.map((folder) => ensureSubfolder(folder, rootId)));
    return meta.parents.some((parentId) => allowedParentIds.includes(parentId));
  } catch {
    return false;
  }
}

async function activeDriveWorkspacesForUser(userId: string): Promise<string[]> {
  const admin = serviceRoleClient();
  if (!admin) return [];
  const { data, error } = await admin
    .from("workspace_members")
    .select("workspace_id, role")
    .eq("user_id", userId)
    .eq("status", "active")
    .limit(50);
  if (error || !data) return [];
  const allowed = new Set((ALLOWED_DRIVE_ROLES as readonly string[]).map((role) => role.toLowerCase()));
  return data
    .filter((row) => allowed.has(String(row.role || "").toLowerCase()))
    .map((row) => String(row.workspace_id))
    .filter(Boolean);
}

async function resolveAuthedMediaWorkspace(userId: string, meta: { appProperties?: Record<string, string>; parents: string[] }): Promise<string | null> {
  const allowedWorkspaces = await activeDriveWorkspacesForUser(userId);
  const fileWorkspaceId = meta.appProperties?.workspaceId;
  if (fileWorkspaceId) {
    return allowedWorkspaces.includes(fileWorkspaceId) ? fileWorkspaceId : null;
  }
  // Untagged Drive files must not inherit workspace ownership from mutable
  // client-writable DB references. Signed app URLs still use signedClaims.
  return null;
}

async function workspaceAuth(req: NextRequest): Promise<{ workspaceId?: string; userId?: string } | null> {
  const bearerToken = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  const auth = bearerToken
    ? await requireBearerTeamRole(req, ALLOWED_DRIVE_ROLES)
    : await requireRole(req, ALLOWED_DRIVE_ROLES as readonly WorkspaceRole[]);
  if (!(auth instanceof Response)) return { workspaceId: auth.workspaceId, userId: auth.user.id };
  if (!bearerToken) {
    const userResult = await requireUser(req);
    if (!(userResult instanceof Response)) return { userId: userResult.user.id };
  }
  return null;
}

async function checkAuth(req: NextRequest, fileId: string): Promise<{
  ok: boolean;
  signed: boolean;
  signedPurpose?: "private" | "publish";
  workspaceId?: string;
  userId?: string;
  knownInWorkspace?: boolean;
  requiresWorkspaceAppProperty?: boolean;
}> {
  const signedToken = req.nextUrl.searchParams.get("token");
  const signedClaims = verifyDriveStreamToken(fileId, signedToken);
  if (signedClaims?.purpose === "publish" || signedClaims?.purpose === "private") {
    return { ok: true, signed: true, signedPurpose: signedClaims.purpose, workspaceId: signedClaims.workspaceId };
  }

  const auth = await workspaceAuth(req);
  if (auth?.workspaceId) {
    const knownInWorkspace = await isKnownAppDriveFile(serviceRoleClient(), fileId, auth.workspaceId);
    const appManaged = knownInWorkspace ? false : await isInAppManagedDriveFolder(fileId);
    if (knownInWorkspace) return { ok: true, signed: false, workspaceId: auth.workspaceId, knownInWorkspace: true };
    if (appManaged) {
      return {
        ok: true,
        signed: false,
        workspaceId: auth.workspaceId,
        requiresWorkspaceAppProperty: true,
      };
    }
    return { ok: true, signed: false, workspaceId: auth.workspaceId };
  }
  if (auth?.userId) return { ok: true, signed: false, userId: auth.userId };

  return { ok: false, signed: false };
}

async function fetchDriveMedia(fileId: string, accessToken: string): Promise<Buffer> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DRIVE_MEDIA_TIMEOUT_MS);
  try {
    const res = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`Drive media fetch failed with HTTP ${res.status}`);
    }
    return Buffer.from(await res.arrayBuffer());
  } finally {
    clearTimeout(timer);
  }
}

export async function GET(request: NextRequest) {
  const fileId = request.nextUrl.searchParams.get("id");
  if (!fileId || !DRIVE_FILE_ID_RE.test(fileId)) {
    return NextResponse.json({ error: "Invalid or missing file ID" }, { status: 400 });
  }

  const auth = await checkAuth(request, fileId);
  if (!auth.ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const [meta, token] = await Promise.all([getFileMetadata(fileId), getAccessToken()]);
    if (auth.userId && !auth.workspaceId) {
      auth.workspaceId = await resolveAuthedMediaWorkspace(auth.userId, meta) || undefined;
      if (!auth.workspaceId) {
        return NextResponse.json({ error: "File does not belong to this workspace" }, { status: 403 });
      }
    }
    const fileWorkspaceId = meta.appProperties?.workspaceId;
    if (
      auth.workspaceId &&
      (
        (fileWorkspaceId && fileWorkspaceId !== auth.workspaceId) ||
        (!fileWorkspaceId && (auth.requiresWorkspaceAppProperty || !auth.signed)) ||
        (!fileWorkspaceId && !(await metadataIsInAppManagedDriveFolder(meta)))
      )
    ) {
      return NextResponse.json({ error: "File does not belong to this workspace" }, { status: 403 });
    }
    const previewSize = previewSizeFromRequest(request);
    const mimeType = normalizeDriveMimeType(meta.mimeType, meta.name);
    const extensionMimeType = normalizeDriveMimeType("", meta.name);
    const heicPreview = isHeicPreviewMime(mimeType, extensionMimeType);
    if (!heicPreview && previewSize !== "thumb") {
      return NextResponse.json({ error: "Preview conversion is only supported for HEIC/HEIF images" }, { status: 415 });
    }
    if (!heicPreview && !isBrowserSafeThumbnailMime(mimeType, extensionMimeType)) {
      return NextResponse.json({ error: "Thumbnail preview is only supported for images" }, { status: 415 });
    }
    if (!Number.isFinite(meta.size) || meta.size <= 0 || meta.size > MAX_PREVIEW_SOURCE_BYTES) {
      return NextResponse.json({ error: "Image is too large for preview conversion" }, { status: 413 });
    }

    const admin = serviceRoleClient();
    const cacheWorkspaceId = auth.workspaceId || meta.appProperties?.workspaceId;
    const cacheFamily: PreviewCacheFamily = heicPreview ? "heic-previews" : "image-previews";
    const cacheKey = previewCacheKey(fileId, cacheWorkspaceId, previewSize, cacheFamily);
    if (previewSize === "thumb") {
      const thumbnailCandidates: Promise<PreviewCandidate | null>[] = [
        readCachedPreview(admin, cacheKey).then((preview) => preview ? { preview, cacheState: "HIT" } : null),
        fetchDriveThumbnail(meta.thumbnailLink, token)
          .then((preview) => preview ? { preview, cacheState: "MISS", writeCacheKey: cacheKey } : null),
      ];
      if (heicPreview) {
        thumbnailCandidates.splice(
          1,
          0,
          buildThumbnailFromCachedPreview(admin, fileId, cacheWorkspaceId)
            .then((preview) => preview ? { preview, cacheState: "HIT", writeCacheKey: cacheKey } : null),
        );
      }
      const fastThumbnail = await withNullTimeout(
        firstAvailablePreview(thumbnailCandidates),
        PREVIEW_FAST_THUMBNAIL_LOOKUP_TIMEOUT_MS,
      );
      if (fastThumbnail) {
        if (fastThumbnail.writeCacheKey) schedulePreviewCacheWrite(admin, fastThumbnail.writeCacheKey, fastThumbnail.preview);
        return browserSafeJpegResponse(fastThumbnail.preview, auth.signedPurpose === "publish" ? "publish" : "private", previewSize, fastThumbnail.cacheState);
      }
    } else {
      const cachedFull = await firstAvailablePreview([
        readCachedPreview(admin, cacheKey).then((preview) => preview ? { preview, cacheState: "HIT" } : null),
        readCachedPreview(admin, legacyPreviewCacheKey(fileId, cacheWorkspaceId))
          .then((preview) => preview ? { preview, cacheState: "HIT" } : null),
      ]);
      if (cachedFull) return browserSafeJpegResponse(cachedFull.preview, auth.signedPurpose === "publish" ? "publish" : "private", previewSize, cachedFull.cacheState);
    }

    const preview = await buildPreviewOnce(cacheKey, async () => {
      const source = await fetchDriveMedia(fileId, token);
      const converted = heicPreview
        ? await buildHeicPreview(source, previewSize)
        : await withPreviewTimeout(
          resizeBrowserSafeJpeg(source, "thumb"),
          PREVIEW_CONVERSION_TIMEOUT_MS.thumb,
          "image thumbnail conversion",
        );
      schedulePreviewCacheWrite(admin, cacheKey, converted);
      return converted;
    });
    return browserSafeJpegResponse(preview, auth.signedPurpose === "publish" ? "publish" : "private", previewSize, "MISS");
  } catch (err) {
    if (err instanceof ImagePreviewHttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const sanitized = sanitizeUnknownUploadError(err);
    const status = statusForSanitizedDriveError(sanitized);
    console.error("[media/image-preview]", sanitizedDriveErrorDetail(sanitized, status));
    return NextResponse.json(sanitized, { status });
  }
}
