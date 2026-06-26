import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireBearerTeamRole } from "@/lib/auth/require";
import { consume, getClientIp } from "@/lib/rate-limit";
import {
  getFileMetadataOrNull,
  getRootFolderId,
  getSubfolderId,
  removePublicPermissions,
  trashDriveFile,
} from "@/lib/google-drive";
import { extractDriveFileIdFromAppUrl } from "@/lib/drive-url-utils";
import { ALLOWED_DRIVE_UPLOAD_ROLES, VALID_DRIVE_FOLDERS } from "@/lib/drive-policy";
import { appRateLimitError } from "@/lib/drive-errors";
import { isValidUuid } from "@/lib/utils";

export const runtime = "nodejs";
export const maxDuration = 60;

// Each asset costs up to 3 sequential Drive calls (metadata + strip-public + trash). Cap
// the per-request batch so a single (authenticated) call cannot exhaust the 60s function
// budget or trip Drive rate limits. Overflow ids are returned as explicit "failed"
// results (NOT silently dropped) so the UI restores them and the user retries in batches.
const MAX_DELETE_BATCH = 25;

type DeleteStatus = "deleted" | "failed";
interface DeleteResult {
  mediaAssetId: string;
  driveFileId: string | null;
  status: DeleteStatus;
  error?: string;
}

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase admin credentials not configured");
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

interface MediaRow {
  id: string;
  url: string | null;
  drive_proxy_url: string | null;
  playback_url: string | null;
  folder: string | null;
}

function resolveFileId(row: MediaRow): string | null {
  // Try every stored app URL; all encode the Drive id as ?id=<fileId>. SERVER-side
  // values only — the browser never supplies the Drive id, so deletion can't be
  // pointed at an arbitrary file.
  return (
    extractDriveFileIdFromAppUrl(row.url) ||
    extractDriveFileIdFromAppUrl(row.drive_proxy_url) ||
    extractDriveFileIdFromAppUrl(row.playback_url)
  );
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireBearerTeamRole(request, ALLOWED_DRIVE_UPLOAD_ROLES);
    if (auth instanceof NextResponse) return auth;
    const { user, workspaceId } = auth;

    const rlKey = `user:${user.id}|ip:${getClientIp(request)}`;
    const rl = await consume("drive-delete-media:user", rlKey, 60, 60, { onError: "deny" });
    if (!rl.allowed) {
      return NextResponse.json(appRateLimitError(rl.resetAt), { status: 429 });
    }

    let body: { mediaAssetIds?: unknown };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    const rawIds = Array.isArray(body.mediaAssetIds) ? body.mediaAssetIds : [];
    const validIds = Array.from(
      new Set(rawIds.filter((id): id is string => typeof id === "string" && isValidUuid(id))),
    );
    if (validIds.length === 0) {
      return NextResponse.json({ error: "No valid media asset IDs provided" }, { status: 400 });
    }
    // Process at most MAX_DELETE_BATCH this call; overflow is reported as failed below.
    const requestedIds = validIds.slice(0, MAX_DELETE_BATCH);
    const overflowIds = validIds.slice(MAX_DELETE_BATCH);

    const admin = getAdminClient();
    // Workspace-scoped load: a caller can only ever act on their own workspace's rows.
    const { data: rows, error: loadError } = await admin
      .from("media_assets")
      .select("id, url, drive_proxy_url, playback_url, folder")
      .in("id", requestedIds)
      .eq("workspace_id", workspaceId);
    if (loadError) {
      console.error("[drive/delete-media] load failed:", loadError.message);
      return NextResponse.json({ error: "Failed to load media assets" }, { status: 500 });
    }

    const loaded = (rows || []) as MediaRow[];
    const loadedIds = new Set(loaded.map((r) => r.id));

    // Resolve the app-managed folder parent IDs ONCE so every asset's Drive parent can
    // be verified against them. A trash only happens if the file truly lives in one.
    const rootId = getRootFolderId();
    const allowedParentIds = new Set<string>();
    for (const folder of VALID_DRIVE_FOLDERS) {
      try {
        // Read-only: never CREATE a folder from inside a delete path.
        const folderId = await getSubfolderId(folder, rootId);
        if (folderId) allowedParentIds.add(folderId);
      } catch (err) {
        console.error(`[drive/delete-media] could not resolve folder ${folder}:`, err instanceof Error ? err.message : err);
      }
    }

    const results: DeleteResult[] = [];

    // Overflow beyond MAX_DELETE_BATCH -> failed (explicit, not dropped) so the UI restores.
    for (const id of overflowIds) {
      results.push({ mediaAssetId: id, driveFileId: null, status: "failed", error: `Too many items selected; delete in batches of ${MAX_DELETE_BATCH}` });
    }

    // Requested-but-not-found (wrong workspace / already gone) -> failed so the UI restores.
    for (const id of requestedIds) {
      if (!loadedIds.has(id)) {
        results.push({ mediaAssetId: id, driveFileId: null, status: "failed", error: "Media asset not found in your workspace" });
      }
    }

    for (const row of loaded) {
      const fileId = resolveFileId(row);
      if (!fileId) {
        results.push({ mediaAssetId: row.id, driveFileId: null, status: "failed", error: "Could not resolve a Drive file ID for this asset" });
        continue;
      }

      // Fail-closed: keep the DB row unless EVERY Drive step succeeds — EXCEPT when the
      // file is already gone from Drive (metadata null = HTTP 404), in which case there is
      // nothing to trash and we fall through to delete the stale row (no eternal orphan).
      try {
        const meta = await getFileMetadataOrNull(fileId);
        if (meta) {
          const inAppFolder = meta.parents.some((p) => allowedParentIds.has(p));
          if (!inAppFolder) {
            results.push({ mediaAssetId: row.id, driveFileId: fileId, status: "failed", error: "File is not in an app-managed Drive folder" });
            continue;
          }
          if (meta.appProperties?.workspaceId && meta.appProperties.workspaceId !== workspaceId) {
            results.push({ mediaAssetId: row.id, driveFileId: fileId, status: "failed", error: "File does not belong to this workspace" });
            continue;
          }

          await removePublicPermissions(fileId);
          await trashDriveFile(fileId);
        }
      } catch (err) {
        console.error("[drive/delete-media] Drive cleanup failed:", err instanceof Error ? err.message : err);
        results.push({ mediaAssetId: row.id, driveFileId: fileId, status: "failed", error: "Drive cleanup failed; asset kept" });
        continue;
      }

      // Only now delete the DB row, scoped to the workspace.
      const { error: delError } = await admin
        .from("media_assets")
        .delete()
        .eq("id", row.id)
        .eq("workspace_id", workspaceId);
      if (delError) {
        console.error("[drive/delete-media] DB delete failed after Drive trash:", delError.message);
        results.push({ mediaAssetId: row.id, driveFileId: fileId, status: "failed", error: "File was trashed but the record could not be deleted; contact support" });
        continue;
      }

      results.push({ mediaAssetId: row.id, driveFileId: fileId, status: "deleted" });
    }

    return NextResponse.json({ results });
  } catch (err) {
    console.error("[drive/delete-media]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Delete failed" }, { status: 500 });
  }
}
