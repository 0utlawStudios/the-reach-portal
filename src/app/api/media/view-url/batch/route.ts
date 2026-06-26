import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { ALLOWED_DRIVE_ROLES } from "@/lib/drive-policy";
import { signDriveStreamToken, signStableThumbToken } from "@/lib/google-drive";
import { requireBearerTeamRole, requireRole, type WorkspaceRole } from "@/lib/auth/require";
import {
  DRIVE_FILE_ID_RE,
  filterKnownAppDriveFiles,
  filterKnownPlaybackObjects,
  parsePlaybackStorageKey,
} from "@/lib/media-access";
import { signPlaybackViewToken } from "@/lib/media-playback-token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 10;

const PRIVATE_VIEW_TOKEN_TTL_MS = 15 * 60 * 1000;
const ALLOWED_MEDIA_PATHS = new Set(["/api/drive/stream", "/api/media/image-preview", "/api/media/playback"]);
// One signed view URL per grid cell; a fresh-device library load coalesces into a handful
// of these. Keep it bounded so a single request can't fan out into unbounded work.
const MAX_BATCH = 200;

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

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const rawUrls = (body as { urls?: unknown })?.urls;
  if (!Array.isArray(rawUrls) || rawUrls.length === 0) {
    return NextResponse.json({ error: "Provide a non-empty urls array" }, { status: 400 });
  }
  if (rawUrls.length > MAX_BATCH) {
    return NextResponse.json({ error: `Too many urls (max ${MAX_BATCH})` }, { status: 400 });
  }

  const auth = await authorize(request);
  if (auth instanceof NextResponse) return auth;

  const admin = serviceRoleClient();
  const origin = request.nextUrl.origin;

  // Parse once; collect the distinct file ids / playback keys for a single batched known-check.
  const parsed = rawUrls.map((raw) => (typeof raw === "string" ? parseMediaUrl(raw, origin) : null));
  const driveIds = parsed.filter((t): t is Extract<ParsedMediaUrl, { kind: "drive" }> => t?.kind === "drive").map((t) => t.fileId);
  const playbackKeys = parsed.filter((t): t is Extract<ParsedMediaUrl, { kind: "playback" }> => t?.kind === "playback").map((t) => t.storageKey);

  const [knownDriveIds, knownPlaybackKeys] = await Promise.all([
    driveIds.length ? filterKnownAppDriveFiles(admin, driveIds, auth.workspaceId) : Promise.resolve(new Set<string>()),
    playbackKeys.length ? filterKnownPlaybackObjects(admin, playbackKeys, auth.workspaceId) : Promise.resolve(new Set<string>()),
  ]);

  const results = rawUrls.map((raw, index) => {
    const target = parsed[index];
    if (!target) return { input: raw, url: null };
    if (target.kind === "drive") {
      if (!knownDriveIds.has(target.fileId)) return { input: raw, url: null };
      // Thumbnails get a STABLE workspace-bound token (edge-cacheable, byte-identical URL);
      // full-res + streams keep the per-request 15-min private token. See view-url/route.ts.
      const isThumb = target.path === "/api/media/image-preview" && target.params.get("size") === "thumb";
      target.params.set(
        "token",
        isThumb
          ? signStableThumbToken(target.fileId, auth.workspaceId)
          : signDriveStreamToken(target.fileId, auth.workspaceId, Date.now() + PRIVATE_VIEW_TOKEN_TTL_MS, "private"),
      );
    } else {
      if (target.workspaceId !== auth.workspaceId || !knownPlaybackKeys.has(target.storageKey)) {
        return { input: raw, url: null };
      }
      target.params.set(
        "token",
        signPlaybackViewToken(target.storageKey, auth.workspaceId, Date.now() + PRIVATE_VIEW_TOKEN_TTL_MS),
      );
    }
    return { input: raw, url: `${target.path}?${target.params.toString()}` };
  });

  return NextResponse.json({ results }, { headers: { "Cache-Control": "no-store" } });
}
