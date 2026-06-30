import { NextRequest, NextResponse } from "next/server";
import { requireBearerTeamRole } from "@/lib/auth/require";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { getFileMetadata } from "@/lib/google-drive";
import { buildMediaSizeMetadataUpdate, driveFileIdForSizeBackfillRow, type MediaSizeBackfillRow } from "@/lib/media-size-backfill";
import { mediaUrlAliases } from "@/lib/media-usage";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ADMIN_ROLES = ["superadmin", "admin", "owner"] as const;

export const runtime = "nodejs";
export const maxDuration = 60;

function isValidUuid(v: string): boolean {
  return UUID_REGEX.test(v);
}

type BackfillRawFile = {
  name?: string;
  url?: string;
  fileId?: string;
  publishUrl?: string;
  driveProxyUrl?: string;
  playbackUrl?: string;
  playbackStorageKey?: string;
  mimeType?: string;
  size?: number;
};

type BackfillEntry = {
  name: string;
  url: string;
  fileType: "image" | "video";
  fileId?: string;
  publishUrl?: string;
  driveProxyUrl?: string;
  playbackUrl?: string;
  playbackStorageKey?: string;
  mimeType?: string;
  size?: number;
};

function compactMetadata(entry: BackfillEntry) {
  const update: Record<string, unknown> = {
    name: entry.name,
    url: entry.url,
    file_type: entry.fileType,
    folder: "Content Engine Uploads",
  };
  if (entry.fileId) update.file_id = entry.fileId;
  if (entry.publishUrl) update.publish_url = entry.publishUrl;
  if (entry.driveProxyUrl) update.drive_proxy_url = entry.driveProxyUrl;
  if (entry.playbackUrl) update.playback_url = entry.playbackUrl;
  if (entry.playbackStorageKey) update.playback_storage_key = entry.playbackStorageKey;
  if (entry.mimeType) update.mime_type = entry.mimeType;
  if (typeof entry.size === "number" && Number.isFinite(entry.size)) update.size_bytes = entry.size;
  return update;
}

export async function POST(request: NextRequest) {
  const auth = await requireBearerTeamRole(request, ADMIN_ROLES);
  if (auth instanceof NextResponse) return auth;

  const admin = createServiceRoleClient();
  const workspaceId = auth.workspaceId;

  // Fetch only this workspace's posts.
  const { data: posts, error: postsErr } = await admin
    .from("posts")
    .select("id, title, thumbnail_url, source_vault, content_type, created_by, workspace_id")
    .eq("workspace_id", workspaceId);

  if (postsErr) {
    return NextResponse.json({ error: postsErr.message }, { status: 500 });
  }

  // Fetch existing media assets only inside this workspace. The same Drive URL
  // can appear in another workspace without affecting this backfill.
  const { data: existingAssets } = await admin
    .from("media_assets")
    .select("id, name, url, file_id, publish_url, drive_proxy_url, playback_url, mime_type, size_bytes, used_in")
    .eq("workspace_id", workspaceId);
  const existingByAlias = new Map<string, { id: string; used_in: string[] }>();
  for (const asset of existingAssets || []) {
    const typed = asset as {
      id: string;
      name?: string | null;
      url?: string | null;
      file_id?: string | null;
      publish_url?: string | null;
      drive_proxy_url?: string | null;
      playback_url?: string | null;
      mime_type?: string | null;
      size_bytes?: number | null;
      used_in?: string[] | null;
    };
    const record = { id: typed.id, used_in: typed.used_in || [] };
    mediaUrlAliases({
      url: typed.url || undefined,
      fileId: typed.file_id || undefined,
      publishUrl: typed.publish_url || undefined,
      driveProxyUrl: typed.drive_proxy_url || undefined,
      playbackUrl: typed.playback_url || undefined,
    }).forEach((alias) => existingByAlias.set(alias, record));
  }

  let inserted = 0;
  let skipped = 0;
  let updated = 0;
  let sizeBackfilled = 0;
  let sizeBackfillFailed = 0;
  let sizeBackfillSkipped = 0;

  for (const post of posts || []) {
    const wsId = post.workspace_id || workspaceId;
    const isVideo = post.content_type === "video" || post.content_type === "reel";

    // Collect all image/video URLs for this post
    const entries: BackfillEntry[] = [];

    if (post.thumbnail_url && !post.thumbnail_url.startsWith("blob:")) {
      entries.push({
        name: post.title || "Post thumbnail",
        url: post.thumbnail_url,
        fileType: isVideo ? "video" : "image",
        fileId: post.source_vault?.thumbnailFileId,
        driveProxyUrl: post.thumbnail_url,
        mimeType: post.source_vault?.thumbnailMimeType,
      });
    }

    const rawFiles: BackfillRawFile[] =
      post.source_vault?.rawFiles || [];
    for (const rf of rawFiles) {
      const url = rf.playbackUrl || rf.driveProxyUrl || rf.url;
      if (url && !url.startsWith("blob:")) {
        entries.push({
          name: rf.name || "Raw file",
          url,
          fileType: rf.mimeType?.startsWith("video") ? "video" : "image",
          fileId: rf.fileId,
          publishUrl: rf.publishUrl || rf.url,
          driveProxyUrl: rf.driveProxyUrl,
          playbackUrl: rf.playbackUrl,
          playbackStorageKey: rf.playbackStorageKey,
          mimeType: rf.mimeType,
          size: rf.size,
        });
      }
    }

    for (const entry of entries) {
      const aliases = mediaUrlAliases(entry);
      const existing = Array.from(aliases).map((alias) => existingByAlias.get(alias)).find(Boolean);

      if (existing) {
        // Row already exists — update used_in if this post isn't already in it
        skipped++;
        const metadataUpdate = compactMetadata(entry);
        if (isValidUuid(post.id) && !existing.used_in.includes(post.id)) {
          const newUsedIn = [...existing.used_in, post.id];
          await admin
            .from("media_assets")
            .update({ ...metadataUpdate, used_in: newUsedIn })
            .eq("id", existing.id)
            .eq("workspace_id", workspaceId);
          aliases.forEach((alias) => existingByAlias.set(alias, { id: existing.id, used_in: newUsedIn }));
          updated++;
        } else {
          await admin
            .from("media_assets")
            .update(metadataUpdate)
            .eq("id", existing.id)
            .eq("workspace_id", workspaceId);
        }
        continue;
      }

      // Insert new row
      const usedInArray = isValidUuid(post.id) ? [post.id] : [];
      const { error } = await admin.from("media_assets").insert({
        ...compactMetadata(entry),
        added_by: post.created_by || "System Backfill",
        workspace_id: wsId,
        used_in: usedInArray,
      });

      if (!error) {
        inserted++;
        aliases.forEach((alias) => existingByAlias.set(alias, { id: "backfilled", used_in: usedInArray }));
      } else {
        console.error("[backfill] insert failed for url", entry.url, error.message);
      }
    }
  }

  const { data: missingSizeAssets, error: missingSizeErr } = await admin
    .from("media_assets")
    .select("id, name, url, file_id, publish_url, drive_proxy_url, playback_url, mime_type, size_bytes")
    .eq("workspace_id", workspaceId)
    .or("size_bytes.is.null,size_bytes.lte.0")
    .limit(250);
  if (missingSizeErr) {
    sizeBackfillFailed++;
    console.error("[backfill] media size lookup failed:", missingSizeErr.message);
  }

  for (const asset of (missingSizeAssets || []) as MediaSizeBackfillRow[]) {
    const fileId = driveFileIdForSizeBackfillRow(asset);
    if (!fileId) continue;
    try {
      const meta = await getFileMetadata(fileId);
      const metadataUpdate = await buildMediaSizeMetadataUpdate(asset, meta, workspaceId, fileId);
      if (!metadataUpdate) {
        sizeBackfillSkipped++;
        continue;
      }
      const { error } = await admin
        .from("media_assets")
        .update(metadataUpdate)
        .eq("id", asset.id)
        .eq("workspace_id", workspaceId);
      if (error) {
        sizeBackfillFailed++;
        console.error("[backfill] size metadata update failed for media asset", asset.id, error.message);
      } else {
        sizeBackfilled++;
      }
    } catch (err) {
      sizeBackfillFailed++;
      console.error("[backfill] Drive metadata lookup failed for media asset", asset.id, err instanceof Error ? err.message : err);
    }
  }

  return NextResponse.json({
    inserted,
    skipped,
    updated,
    sizeBackfilled,
    sizeBackfillFailed,
    sizeBackfillSkipped,
    total: (posts || []).length,
    message: `Backfill complete. ${inserted} new, ${skipped} already existed (${updated} had used_in updated), ${sizeBackfilled} media size rows repaired, ${(posts || []).length} posts scanned.`,
  });
}
