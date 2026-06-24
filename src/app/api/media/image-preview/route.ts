import sharp from "sharp";
import decodeHeic from "heic-decode";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  ensureSubfolder,
  getAccessToken,
  getFileMetadata,
  getRootFolderId,
  verifyDriveStreamToken,
} from "@/lib/google-drive";
import { ALLOWED_DRIVE_ROLES, normalizeDriveMimeType, VALID_DRIVE_FOLDERS } from "@/lib/drive-policy";
import { sanitizeUnknownUploadError, statusForSanitizedDriveError } from "@/lib/drive-errors";
import { requireBearerTeamRole } from "@/lib/auth/require";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const DRIVE_FILE_ID_RE = /^[a-zA-Z0-9_-]{20,80}$/;
const HEIC_IMAGE_MIME_TYPES = new Set(["image/heic", "image/heic-sequence", "image/heif", "image/heif-sequence"]);
const MAX_PREVIEW_SOURCE_BYTES = 50 * 1024 * 1024;
const PREVIEW_MAX_EDGE = 1600;
// heic-decode allocates raw RGBA in JS/WASM before Sharp can resize it. Cap the
// fallback below Sharp's native limit so common 48MP iPhone HEICs still preview
// while larger panoramas fail closed before raw decode.
const HEIC_FALLBACK_MAX_PIXELS = 50_000_000;
const DRIVE_MEDIA_TIMEOUT_MS = 45_000;

type HeicDecodedImage = {
  width: number;
  height: number;
  data: Uint8ClampedArray | Uint8Array;
};

class ImagePreviewHttpError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ImagePreviewHttpError";
    this.status = status;
  }
}

function browserSafeJpegResponse(preview: Buffer, signed: boolean) {
  const responseBody = preview.buffer.slice(preview.byteOffset, preview.byteOffset + preview.byteLength) as ArrayBuffer;

  return new Response(responseBody, {
    status: 200,
    headers: {
      "Content-Type": "image/jpeg",
      "Content-Length": String(preview.length),
      "Cache-Control": signed ? "public, max-age=86400, immutable" : "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function resizeBrowserSafeJpeg(source: Buffer) {
  return sharp(source, { limitInputPixels: HEIC_FALLBACK_MAX_PIXELS })
    .rotate()
    .resize({
      width: PREVIEW_MAX_EDGE,
      height: PREVIEW_MAX_EDGE,
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality: 86, mozjpeg: true })
    .toBuffer();
}

function assertFallbackPixelSafe(width: number, height: number) {
  const pixels = width * height;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0 || pixels > HEIC_FALLBACK_MAX_PIXELS) {
    throw new ImagePreviewHttpError("Image is too large for preview conversion", 413);
  }
}

function resizeRawBrowserSafeJpeg(image: HeicDecodedImage) {
  assertFallbackPixelSafe(image.width, image.height);
  return sharp(image.data, {
    raw: {
      width: image.width,
      height: image.height,
      channels: 4,
    },
    limitInputPixels: HEIC_FALLBACK_MAX_PIXELS,
  })
    .resize({
      width: PREVIEW_MAX_EDGE,
      height: PREVIEW_MAX_EDGE,
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality: 86, mozjpeg: true })
    .toBuffer();
}

async function convertHeicWithFallbackDecoder(source: Buffer) {
  const images = await decodeHeic.all({ buffer: source });
  try {
    const image = images[0];
    if (!image) throw new Error("HEIF image not found");
    assertFallbackPixelSafe(image.width, image.height);
    return resizeRawBrowserSafeJpeg(await image.decode());
  } finally {
    try {
      images.dispose();
    } catch {
      // Best-effort cleanup only; preserve the conversion error if one exists.
    }
  }
}

async function buildHeicPreview(source: Buffer) {
  if (sharp.format.heif?.input.buffer) {
    try {
      return await resizeBrowserSafeJpeg(source);
    } catch {
      // Some runtimes expose HEIF metadata support but cannot decode iPhone HEVC HEIC payloads.
    }
  }

  return convertHeicWithFallbackDecoder(source);
}

function serviceRoleClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function sourceReferencesDriveFile(value: unknown, fileId: string): boolean {
  if (typeof value === "string") return value.includes(fileId);
  if (Array.isArray(value)) return value.some((item) => sourceReferencesDriveFile(item, fileId));
  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).some((item) => sourceReferencesDriveFile(item, fileId));
  }
  return false;
}

async function isKnownAppDriveFile(fileId: string, workspaceId?: string): Promise<boolean> {
  const admin = serviceRoleClient();
  if (!admin) return false;

  let mediaQuery = admin
      .from("media_assets")
      .select("id")
      .ilike("url", `%${fileId}%`)
      .limit(1);
  let postsQuery = admin
      .from("posts")
      .select("id, thumbnail_url, source_vault")
      .or(`thumbnail_url.ilike.%${fileId}%`)
      .limit(1);
  if (workspaceId) {
    mediaQuery = mediaQuery.eq("workspace_id", workspaceId);
    postsQuery = postsQuery.eq("workspace_id", workspaceId);
  }

  const [media, posts] = await Promise.all([mediaQuery, postsQuery]);
  if (!media.error && media.data && media.data.length > 0) return true;
  if (!posts.error && posts.data && posts.data.length > 0) return true;

  let sourceQuery = admin
    .from("posts")
    .select("id, source_vault")
    .not("source_vault", "is", null)
    .limit(1000);
  if (workspaceId) sourceQuery = sourceQuery.eq("workspace_id", workspaceId);
  const { data: sourceRows, error: sourceError } = await sourceQuery;
  if (sourceError || !sourceRows) return false;
  return sourceRows.some((row) => sourceReferencesDriveFile(row.source_vault, fileId));
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

async function checkAuth(req: NextRequest, fileId: string): Promise<{ ok: boolean; signed: boolean; workspaceId?: string }> {
  const signedToken = req.nextUrl.searchParams.get("token");
  const signedClaims = verifyDriveStreamToken(fileId, signedToken);
  if (signedClaims) return { ok: true, signed: true, workspaceId: signedClaims.workspaceId };

  const token = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  if (token) {
    const auth = await requireBearerTeamRole(req, ALLOWED_DRIVE_ROLES);
    if (!(auth instanceof Response)) {
      const knownInWorkspace = await isKnownAppDriveFile(fileId, auth.workspaceId);
      const appManaged = knownInWorkspace ? false : await isInAppManagedDriveFolder(fileId);
      if (knownInWorkspace || appManaged) {
        return { ok: true, signed: false, workspaceId: auth.workspaceId };
      }
    }
  }

  const referer = req.headers.get("referer") || "";
  let refOk = false;
  if (referer) {
    try {
      const origin = new URL(referer).origin;
      const siteOrigin = new URL(process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000").origin;
      refOk = origin === siteOrigin || origin === "http://localhost:3000" || origin === "http://localhost:3001";
    } catch {
      refOk = false;
    }
  }

  return {
    ok: refOk && (await isKnownAppDriveFile(fileId) || await isInAppManagedDriveFolder(fileId)),
    signed: false,
  };
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
    if (auth.workspaceId && meta.appProperties?.workspaceId && meta.appProperties.workspaceId !== auth.workspaceId) {
      return NextResponse.json({ error: "File does not belong to this workspace" }, { status: 403 });
    }
    const mimeType = normalizeDriveMimeType(meta.mimeType, meta.name);
    const extensionMimeType = normalizeDriveMimeType("", meta.name);
    if (!HEIC_IMAGE_MIME_TYPES.has(mimeType) && !HEIC_IMAGE_MIME_TYPES.has(extensionMimeType)) {
      return NextResponse.json({ error: "Preview conversion is only supported for HEIC/HEIF images" }, { status: 415 });
    }
    if (!Number.isFinite(meta.size) || meta.size <= 0 || meta.size > MAX_PREVIEW_SOURCE_BYTES) {
      return NextResponse.json({ error: "Image is too large for preview conversion" }, { status: 413 });
    }

    const source = await fetchDriveMedia(fileId, token);
    const preview = await buildHeicPreview(source);
    return browserSafeJpegResponse(preview, auth.signed);
  } catch (err) {
    if (err instanceof ImagePreviewHttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const sanitized = sanitizeUnknownUploadError(err);
    console.error("[media/image-preview]", err instanceof Error ? err.message : err);
    return NextResponse.json(sanitized, { status: statusForSanitizedDriveError(sanitized) });
  }
}
