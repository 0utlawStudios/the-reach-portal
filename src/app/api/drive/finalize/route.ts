import { NextRequest, NextResponse } from "next/server";
import { ensureSubfolder, getRootFolderId, setPublicPermission, getStreamUrl, getFileMetadata } from "@/lib/google-drive";
import { requireBearerTeamRole } from "@/lib/auth/require";
import { consume, getClientIp } from "@/lib/rate-limit";
import { VALID_DRIVE_FOLDERS } from "@/lib/drive-policy";

export const maxDuration = 10;

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
  try {
    // SEC-002: Gate on bearer-team-role. Without this, an unauthenticated
    // caller could iterate fileIds and force-publicize unrelated workspace
    // assets.
    const auth = await requireBearerTeamRole(request, ALLOWED_FINALIZE_ROLES);
    if (auth instanceof NextResponse) return auth;
    const { user } = auth;

    // SEC-002: 60/min/user. Same envelope as publish-jobs — finalize is a
    // bursty action when a creator uploads several files in a row but
    // shouldn't be hammered.
    const rlKey = `user:${user.id}|ip:${getClientIp(request)}`;
    const rl = await consume("drive-finalize:user", rlKey, 60, 60);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Too many finalize requests. Please slow down." },
        { status: 429 },
      );
    }

    const { fileId } = await request.json();

    if (!fileId || typeof fileId !== "string") {
      return NextResponse.json({ error: "Missing fileId" }, { status: 400 });
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
    const allowedParentIds = await Promise.all(VALID_DRIVE_FOLDERS.map((folder) => ensureSubfolder(folder, rootId)));
    const belongsToAppFolder = meta.parents.some((parentId) => allowedParentIds.includes(parentId));
    if (!belongsToAppFolder) {
      return NextResponse.json({ error: "File is not in an app-managed Drive folder" }, { status: 403 });
    }

    // Set public permission so the file is servable
    await setPublicPermission(fileId);

    const isImage = meta.mimeType.startsWith("image/");
    const isVideo = meta.mimeType.startsWith("video/");

    // Always use our stream proxy as primary URL — it's authenticated server-side
    // and works immediately (lh3 URLs break during Google permission propagation)
    const proxyUrl = getStreamUrl(fileId);

    return NextResponse.json({
      fileId,
      imageUrl: isImage ? proxyUrl : null,
      streamUrl: isVideo ? proxyUrl : null,
      url: proxyUrl,
      mimeType: meta.mimeType,
      size: meta.size,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[drive/finalize]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
