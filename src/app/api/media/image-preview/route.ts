import sharp from "sharp";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  ensureSubfolder,
  getAccessToken,
  getFileMetadata,
  getRootFolderId,
  verifyDriveStreamToken,
} from "@/lib/google-drive";
import { normalizeDriveMimeType, VALID_DRIVE_FOLDERS } from "@/lib/drive-policy";
import { sanitizeUnknownUploadError, statusForSanitizedDriveError } from "@/lib/drive-errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const DRIVE_FILE_ID_RE = /^[a-zA-Z0-9_-]{20,80}$/;
const HEIC_IMAGE_MIME_TYPES = new Set(["image/heic", "image/heif"]);
const MAX_PREVIEW_SOURCE_BYTES = 50 * 1024 * 1024;
const PREVIEW_MAX_EDGE = 1600;
const DRIVE_MEDIA_TIMEOUT_MS = 45_000;

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

async function isKnownAppDriveFile(fileId: string): Promise<boolean> {
  const admin = serviceRoleClient();
  if (!admin) return false;

  const [media, posts] = await Promise.all([
    admin
      .from("media_assets")
      .select("id")
      .ilike("url", `%${fileId}%`)
      .limit(1),
    admin
      .from("posts")
      .select("id, thumbnail_url, source_vault")
      .or(`thumbnail_url.ilike.%${fileId}%`)
      .limit(1),
  ]);
  if (!media.error && media.data && media.data.length > 0) return true;
  if (!posts.error && posts.data && posts.data.length > 0) return true;

  const { data: sourceRows, error: sourceError } = await admin
    .from("posts")
    .select("id, source_vault")
    .not("source_vault", "is", null)
    .limit(1000);
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

async function checkAuth(req: NextRequest, fileId: string): Promise<{ ok: boolean; signed: boolean }> {
  const signedToken = req.nextUrl.searchParams.get("token");
  if (verifyDriveStreamToken(fileId, signedToken)) return { ok: true, signed: true };

  const token = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  if (token) {
    const admin = serviceRoleClient();
    if (admin) {
      try {
        const { data, error } = await admin.auth.getUser(token);
        if (!error && data.user) return { ok: true, signed: false };
      } catch {
        // Fall through to same-origin file checks.
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
    const mimeType = normalizeDriveMimeType(meta.mimeType, meta.name);
    if (!HEIC_IMAGE_MIME_TYPES.has(mimeType)) {
      return NextResponse.json({ error: "Preview conversion is only supported for HEIC/HEIF images" }, { status: 415 });
    }
    if (!Number.isFinite(meta.size) || meta.size <= 0 || meta.size > MAX_PREVIEW_SOURCE_BYTES) {
      return NextResponse.json({ error: "Image is too large for preview conversion" }, { status: 413 });
    }
    if (!sharp.format.heif?.input.buffer) {
      return NextResponse.json({ error: "HEIC preview conversion is unavailable in this runtime" }, { status: 415 });
    }

    const source = await fetchDriveMedia(fileId, token);
    const preview = await sharp(source, { limitInputPixels: 100_000_000 })
      .rotate()
      .resize({
        width: PREVIEW_MAX_EDGE,
        height: PREVIEW_MAX_EDGE,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: 86, mozjpeg: true })
      .toBuffer();
    const responseBody = preview.buffer.slice(preview.byteOffset, preview.byteOffset + preview.byteLength) as ArrayBuffer;

    return new Response(responseBody, {
      status: 200,
      headers: {
        "Content-Type": "image/jpeg",
        "Content-Length": String(preview.length),
        "Cache-Control": auth.signed ? "public, max-age=86400, immutable" : "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err) {
    const sanitized = sanitizeUnknownUploadError(err);
    console.error("[media/image-preview]", err instanceof Error ? err.message : err);
    return NextResponse.json(sanitized, { status: statusForSanitizedDriveError(sanitized) });
  }
}
