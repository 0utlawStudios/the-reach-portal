import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { ALLOWED_DRIVE_ROLES } from "@/lib/drive-policy";
import { signDriveStreamToken } from "@/lib/google-drive";
import { requireBearerTeamRole, requireRole, type WorkspaceRole } from "@/lib/auth/require";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 10;

const DRIVE_FILE_ID_RE = /^[a-zA-Z0-9_-]{20,80}$/;
const PRIVATE_VIEW_TOKEN_TTL_MS = 15 * 60 * 1000;
const ALLOWED_MEDIA_PATHS = new Set(["/api/drive/stream", "/api/media/image-preview"]);

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

async function isKnownAppDriveFile(fileId: string, workspaceId: string): Promise<boolean> {
  const admin = serviceRoleClient();
  if (!admin) return false;

  const [media, posts] = await Promise.all([
    admin
      .from("media_assets")
      .select("id")
      .eq("workspace_id", workspaceId)
      .or(`file_id.eq.${fileId},url.ilike.%${fileId}%,drive_proxy_url.ilike.%${fileId}%,publish_url.ilike.%${fileId}%,playback_url.ilike.%${fileId}%`)
      .limit(1),
    admin
      .from("posts")
      .select("id, thumbnail_url")
      .eq("workspace_id", workspaceId)
      .or(`thumbnail_url.ilike.%${fileId}%`)
      .limit(1),
  ]);

  if (!media.error && media.data && media.data.length > 0) return true;
  if (!posts.error && posts.data && posts.data.length > 0) return true;

  const { data: sourceRows, error: sourceError } = await admin
    .from("posts")
    .select("id, source_vault")
    .eq("workspace_id", workspaceId)
    .not("source_vault", "is", null)
    .limit(1000);
  if (sourceError || !sourceRows) return false;
  return sourceRows.some((row) => sourceReferencesDriveFile(row.source_vault, fileId));
}

function parseMediaUrl(value: string | null, origin: string): { path: string; params: URLSearchParams; fileId: string } | null {
  if (!value) return null;
  try {
    const parsed = new URL(value, origin);
    if (!ALLOWED_MEDIA_PATHS.has(parsed.pathname)) return null;
    const fileId = parsed.searchParams.get("id") || "";
    if (!DRIVE_FILE_ID_RE.test(fileId)) return null;
    const params = new URLSearchParams({ id: fileId });
    if (parsed.pathname === "/api/media/image-preview") {
      const size = parsed.searchParams.get("size");
      if (size === "thumb" || size === "full") params.set("size", size);
    }
    return { path: parsed.pathname, params, fileId };
  } catch {
    return null;
  }
}

async function authorize(request: NextRequest) {
  const bearerToken = request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  return bearerToken
    ? requireBearerTeamRole(request, ALLOWED_DRIVE_ROLES)
    : requireRole(request, ALLOWED_DRIVE_ROLES as readonly WorkspaceRole[]);
}

export async function GET(request: NextRequest) {
  const target = parseMediaUrl(request.nextUrl.searchParams.get("url"), request.nextUrl.origin);
  if (!target) {
    return NextResponse.json({ error: "Invalid media URL" }, { status: 400 });
  }

  const auth = await authorize(request);
  if (auth instanceof NextResponse) return auth;

  const known = await isKnownAppDriveFile(target.fileId, auth.workspaceId);
  if (!known) {
    return NextResponse.json({ error: "Media file is not available to this workspace" }, { status: 403 });
  }

  target.params.set(
    "token",
    signDriveStreamToken(target.fileId, auth.workspaceId, Date.now() + PRIVATE_VIEW_TOKEN_TTL_MS, "private"),
  );

  return NextResponse.json(
    { url: `${target.path}?${target.params.toString()}` },
    { headers: { "Cache-Control": "no-store" } },
  );
}
