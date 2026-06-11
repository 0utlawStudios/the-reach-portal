import { NextRequest, NextResponse } from "next/server";
import { ensureSubfolder, getRootFolderId, setPublicPermission, getStreamUrl, getFileMetadata, getDriveDownloadUrl } from "@/lib/google-drive";
import { requireBearerTeamRole } from "@/lib/auth/require";
import { consume, getClientIp } from "@/lib/rate-limit";
import {
  type DriveFolderName,
  isAllowedDriveMediaMime,
  MAX_DRIVE_MEDIA_FILE_SIZE,
  normalizeDriveMimeType,
  VALID_DRIVE_FOLDERS,
} from "@/lib/drive-policy";
import { notifyUploadFailure } from "@/lib/upload-alerts";
import {
  appRateLimitError,
  sanitizeUnknownUploadError,
  statusForSanitizedDriveError,
} from "@/lib/drive-errors";

export const maxDuration = 60;

// SEC-002: Drive file IDs are base64-url-ish strings, generally 20-80 chars.
// We don't want to forward arbitrary client input into Drive API calls or
// audit logs.
const DRIVE_FILE_ID_RE = /^[a-zA-Z0-9_-]{20,80}$/;

// Any active team member can finalize, but the file must already live under
// one of this app's managed Drive folders before permissions are changed.
const ALLOWED_FINALIZE_ROLES: ReadonlyArray<string> = [
  "superadmin",
  "admin",
  "owner",
  "approver",
  "creative_director",
  "editor",
  "social_media_specialist",
  "video_editor",
  "graphic_designer",
  "specialist",
  "technician",
  "viewer",
];

export async function POST(request: NextRequest) {
  let authContext: { user: { id: string }; email: string; role: string; workspaceId: string } | null = null;
  let fileId: string | null = null;
  let folder: DriveFolderName | null = null;
  try {
    // SEC-002: Gate on bearer-team-role. Without this, an unauthenticated
    // caller could iterate fileIds and force-publicize unrelated workspace
    // assets.
    const auth = await requireBearerTeamRole(request, ALLOWED_FINALIZE_ROLES);
    if (auth instanceof NextResponse) return auth;
    authContext = auth;
    const { user } = auth;

    // SEC-002: 60/min/user. Same envelope as publish-jobs — finalize is a
    // bursty action when a creator uploads several files in a row but
    // shouldn't be hammered.
    const rlKey = `user:${user.id}|ip:${getClientIp(request)}`;
    const rl = await consume("drive-finalize:user", rlKey, 60, 60);
    if (!rl.allowed) {
      const limited = appRateLimitError(rl.resetAt);
      return NextResponse.json(
        limited,
        { status: 429 },
      );
    }

    const body = await request.json();
    fileId = typeof body?.fileId === "string" ? body.fileId : null;
    folder = typeof body?.folder === "string" ? body.folder as DriveFolderName : null;

    if (!fileId) {
      return NextResponse.json({ error: "Missing fileId" }, { status: 400 });
    }
    if (!folder || !VALID_DRIVE_FOLDERS.includes(folder)) {
      return NextResponse.json({ error: "Invalid folder" }, { status: 400 });
    }
    // SEC-002: Reject malformed fileIds before we hand them to the Drive API.
    if (!DRIVE_FILE_ID_RE.test(fileId)) {
      return NextResponse.json({ error: "Invalid fileId" }, { status: 400 });
    }

    // Get metadata before changing permissions. A valid-looking file ID is not
    // enough: the service account may see other files, and this route must not
    // publicize arbitrary Drive content.
    const meta = await getFileMetadata(fileId);
    const rootId = getRootFolderId();
    const allowedParentId = await ensureSubfolder(folder, rootId);
    const belongsToAppFolder = meta.parents.includes(allowedParentId);
    if (!belongsToAppFolder) {
      return NextResponse.json({ error: "File is not in an app-managed Drive folder" }, { status: 403 });
    }
    const mimeType = normalizeDriveMimeType(meta.mimeType, meta.name);
    if (!isAllowedDriveMediaMime(mimeType)) {
      return NextResponse.json({ error: "Unsupported file type" }, { status: 415 });
    }
    if (!Number.isFinite(meta.size) || meta.size <= 0) {
      return NextResponse.json({ error: "Missing or invalid file size" }, { status: 400 });
    }
    if (meta.size > MAX_DRIVE_MEDIA_FILE_SIZE) {
      return NextResponse.json(
        { error: `File exceeds ${MAX_DRIVE_MEDIA_FILE_SIZE / (1024 * 1024)}MB limit.` },
        { status: 413 },
      );
    }

    // Set public permission so the file is servable
    await setPublicPermission(fileId);

    const isImage = mimeType.startsWith("image/");
    const isVideo = mimeType.startsWith("video/");

    // Always use our stream proxy as primary URL — it's authenticated server-side
    // and works immediately (lh3 URLs break during Google permission propagation)
    const proxyUrl = getStreamUrl(fileId);
    const publishUrl = getDriveDownloadUrl(fileId);

    return NextResponse.json({
      fileId,
      imageUrl: isImage ? proxyUrl : null,
      streamUrl: isVideo ? proxyUrl : null,
      url: proxyUrl,
      driveProxyUrl: proxyUrl,
      publishUrl,
      mimeType,
      size: meta.size,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    const sanitized = sanitizeUnknownUploadError(err);
    console.error("[drive/finalize]", message);
    if (authContext) {
      await notifyUploadFailure({
        source: "server",
        phase: "finalize_upload",
        route: "/api/drive/finalize",
        uploadPath: "resumable",
        workspaceId: authContext.workspaceId,
        userId: authContext.user.id,
        userEmail: authContext.email,
        userRole: authContext.role,
        folder,
        fileName: fileId,
        errorMessage: sanitized.error,
        errorStatus: statusForSanitizedDriveError(sanitized),
        errorDetail: message,
        userAgent: request.headers.get("user-agent"),
        ip: getClientIp(request),
        requestUrl: request.url,
      });
    }
    return NextResponse.json(sanitized, { status: statusForSanitizedDriveError(sanitized) });
  }
}
