import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { ALLOWED_DRIVE_ROLES } from "@/lib/drive-policy";
import { signDriveStreamToken, signStableThumbToken } from "@/lib/google-drive";
import { requireBearerTeamRole, requireRole, type WorkspaceRole } from "@/lib/auth/require";
import { DRIVE_FILE_ID_RE, isKnownAppDriveFile, isKnownPlaybackObject, parsePlaybackStorageKey } from "@/lib/media-access";
import { signPlaybackViewToken } from "@/lib/media-playback-token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 10;

const PRIVATE_VIEW_TOKEN_TTL_MS = 15 * 60 * 1000;
const ALLOWED_MEDIA_PATHS = new Set(["/api/drive/stream", "/api/media/image-preview", "/api/media/playback"]);

type ParsedMediaUrl =
  | { kind: "drive"; path: string; params: URLSearchParams; fileId: string }
  | { kind: "playback"; path: string; params: URLSearchParams; storageKey: string; workspaceId: string };

function serviceRoleClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function parseMediaUrl(value: string | null, origin: string): ParsedMediaUrl | null {
  if (!value) return null;
  try {
    const parsed = new URL(value, origin);
    if (!ALLOWED_MEDIA_PATHS.has(parsed.pathname)) return null;
    if (parsed.pathname === "/api/media/playback") {
      const playback = parsePlaybackStorageKey(parsed.searchParams.get("key"));
      if (!playback) return null;
      return {
        kind: "playback",
        path: parsed.pathname,
        params: new URLSearchParams({ key: playback.key }),
        storageKey: playback.key,
        workspaceId: playback.workspaceId,
      };
    }
    const fileId = parsed.searchParams.get("id") || "";
    if (!DRIVE_FILE_ID_RE.test(fileId)) return null;
    const params = new URLSearchParams({ id: fileId });
    if (parsed.pathname === "/api/media/image-preview") {
      const size = parsed.searchParams.get("size");
      if (size === "thumb" || size === "full") params.set("size", size);
    }
    return { kind: "drive", path: parsed.pathname, params, fileId };
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

  const admin = serviceRoleClient();
  const known = target.kind === "drive"
    ? await isKnownAppDriveFile(admin, target.fileId, auth.workspaceId)
    : target.workspaceId === auth.workspaceId && await isKnownPlaybackObject(admin, target.storageKey, auth.workspaceId);
  if (!known) {
    return NextResponse.json({ error: "Media file is not available to this workspace" }, { status: 403 });
  }

  if (target.kind === "drive") {
    // A thumbnail is a low-sensitivity poster: mint a STABLE workspace-bound token so the URL is
    // byte-identical across signs and edge-cacheable. Full-res + streams keep the per-request
    // 15-min private token (per-user gating). See signStableThumbToken / PLAN-thereach-thumbnail-stable-token.md.
    const isThumb = target.path === "/api/media/image-preview" && target.params.get("size") === "thumb";
    target.params.set(
      "token",
      isThumb
        ? signStableThumbToken(target.fileId, auth.workspaceId)
        : signDriveStreamToken(target.fileId, auth.workspaceId, Date.now() + PRIVATE_VIEW_TOKEN_TTL_MS, "private"),
    );
  } else {
    target.params.set(
      "token",
      signPlaybackViewToken(target.storageKey, auth.workspaceId, Date.now() + PRIVATE_VIEW_TOKEN_TTL_MS),
    );
  }

  return NextResponse.json(
    { url: `${target.path}?${target.params.toString()}` },
    { headers: { "Cache-Control": "no-store" } },
  );
}
