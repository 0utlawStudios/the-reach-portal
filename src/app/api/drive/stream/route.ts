import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { ensureSubfolder, getAccessToken, getFileMetadata, getRootFolderId, verifyDriveStreamToken } from "@/lib/google-drive";
import { ALLOWED_DRIVE_ROLES, VALID_DRIVE_FOLDERS } from "@/lib/drive-policy";
import { sanitizeUnknownUploadError, statusForSanitizedDriveError } from "@/lib/drive-errors";
import { requireBearerTeamRole, requireRole, type WorkspaceRole } from "@/lib/auth/require";

export const maxDuration = 60; // Fluid Compute — stays alive while streaming

// Allow-list of origins permitted to stream Drive content. Production app +
// localhost dev. CORS:* was a P0 finding (anonymous cross-site streaming).
const SITE_ORIGIN = (() => {
  try {
    return new URL(process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000").origin;
  } catch {
    return "http://localhost:3000";
  }
})();

const ALLOWED_ORIGINS = new Set([
  SITE_ORIGIN,
  "http://localhost:3000",
  "http://localhost:3001",
]);

function corsHeadersFor(req: NextRequest): Record<string, string> {
  const origin = req.headers.get("origin") || "";
  const allow = ALLOWED_ORIGINS.has(origin) ? origin : SITE_ORIGIN;
  return {
    "Access-Control-Allow-Origin": allow,
    "Vary": "Origin",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Range, Authorization",
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Expose-Headers": "Content-Range, Content-Length, Accept-Ranges",
  };
}

// ─── CORS preflight ───
export async function OPTIONS(request: NextRequest) {
  return new Response(null, { status: 204, headers: corsHeadersFor(request) });
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

async function workspaceAuth(req: NextRequest): Promise<{ workspaceId: string } | null> {
  const bearerToken = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  const auth = bearerToken
    ? await requireBearerTeamRole(req, ALLOWED_DRIVE_ROLES)
    : await requireRole(req, ALLOWED_DRIVE_ROLES as readonly WorkspaceRole[]);
  if (auth instanceof Response) return null;
  return { workspaceId: auth.workspaceId };
}

// SEC-003: Validate the request with a signed app URL, a Bearer token, or the
// server-readable session cookie maintained by AuthProvider. Referer is not an
// authorization boundary: browsers may omit it, and non-browser callers can
// forge it.
async function checkAuth(req: NextRequest, fileId: string): Promise<{
  ok: boolean;
  authed: boolean;
  signed: boolean;
  workspaceId?: string;
  requiresWorkspaceAppProperty?: boolean;
}> {
  const signedToken = req.nextUrl.searchParams.get("token");
  const signedClaims = verifyDriveStreamToken(fileId, signedToken);
  if (signedClaims) {
    return { ok: true, authed: true, signed: true, workspaceId: signedClaims.workspaceId };
  }

  const auth = await workspaceAuth(req);
  if (auth) {
    const knownInWorkspace = await isKnownAppDriveFile(fileId, auth.workspaceId);
    const appManaged = knownInWorkspace ? false : await isInAppManagedDriveFolder(fileId);
    if (knownInWorkspace) {
      return { ok: true, authed: true, signed: false, workspaceId: auth.workspaceId };
    }
    if (appManaged) {
      return {
        ok: true,
        authed: true,
        signed: false,
        workspaceId: auth.workspaceId,
        requiresWorkspaceAppProperty: true,
      };
    }
  }

  return { ok: false, authed: false, signed: false };
}

// ─── Stream proxy with Range support ───
export async function GET(request: NextRequest) {
  const corsHeaders = corsHeadersFor(request);
  const fileId = request.nextUrl.searchParams.get("id");

  // SEC-009: Tightened to match drive/finalize — Drive file IDs are 20-80
  // char base64-url-ish strings. The old `/^[\w-]+$/` accepted any length.
  if (!fileId || !/^[a-zA-Z0-9_-]{20,80}$/.test(fileId)) {
    return new Response(JSON.stringify({ error: "Invalid or missing file ID" }), {
      status: 400,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }

  const auth = await checkAuth(request, fileId);
  if (!auth.ok) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }

  try {
    // Get file metadata for Content-Type and size.
    // PERF-003: metadata fetch and token mint are independent — run them
    // concurrently instead of sequentially.
    const [meta, token] = await Promise.all([getFileMetadata(fileId), getAccessToken()]);
    if (
      auth.workspaceId &&
      (
        (auth.requiresWorkspaceAppProperty && meta.appProperties?.workspaceId !== auth.workspaceId) ||
        (meta.appProperties?.workspaceId && meta.appProperties.workspaceId !== auth.workspaceId)
      )
    ) {
      return new Response(JSON.stringify({ error: "File does not belong to this workspace" }), {
        status: 403,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }
    const driveUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;

    const rangeHeader = request.headers.get("range");

    // Build headers for the Google Drive request
    const driveHeaders: Record<string, string> = {
      Authorization: `Bearer ${token}`,
    };
    // Only forward well-formed Range headers
    if (rangeHeader && /^bytes=\d*-\d*$/.test(rangeHeader)) {
      driveHeaders["Range"] = rangeHeader;
    }

    // Fetch from Google Drive. Bound the time-to-response with an AbortController
    // (mirrors proxy-upload / upload-chunk / driveFetch) so a Google connection
    // that stalls before sending response headers fails fast with a sanitized
    // error instead of hanging until maxDuration. The timer is cleared the moment
    // headers arrive, so it never interrupts a legitimate in-flight byte stream.
    const streamController = new AbortController();
    const streamTimer = setTimeout(() => streamController.abort(), 45000);
    let driveRes: Response;
    try {
      driveRes = await fetch(driveUrl, { headers: driveHeaders, signal: streamController.signal });
    } finally {
      clearTimeout(streamTimer);
    }

    if (!driveRes.ok && driveRes.status !== 206) {
      return new Response(JSON.stringify({ error: "Failed to fetch file from Drive" }), {
        status: driveRes.status,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    // SEC-003: Cache policy mirrors the auth path used.
    const cacheControl = auth.signed
      ? "public, max-age=86400, immutable"
      : auth.authed
      ? "private, max-age=86400, immutable"
      : "private, no-store";

    const responseHeaders: Record<string, string> = {
      "Content-Type": meta.mimeType,
      "Accept-Ranges": "bytes",
      "Cache-Control": cacheControl,
      ...corsHeaders,
    };

    // Forward Content-Range and Content-Length from Google's response
    const contentRange = driveRes.headers.get("content-range");
    const contentLength = driveRes.headers.get("content-length");
    if (contentRange) responseHeaders["Content-Range"] = contentRange;
    if (contentLength) responseHeaders["Content-Length"] = contentLength;

    // Stream the response body — never buffer
    return new Response(driveRes.body, {
      status: driveRes.status,
      headers: responseHeaders,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    const sanitized = sanitizeUnknownUploadError(err);
    console.error("[drive/stream]", message);
    return new Response(JSON.stringify(sanitized), {
      status: statusForSanitizedDriveError(sanitized),
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }
}
