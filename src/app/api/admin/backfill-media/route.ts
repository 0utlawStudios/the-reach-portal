import { NextRequest, NextResponse } from "next/server";
import { requireBearerTeamRole } from "@/lib/auth/require";
import { createServiceRoleClient } from "@/lib/supabase/server";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ADMIN_ROLES = ["superadmin", "admin", "owner"] as const;

export const runtime = "nodejs";
export const maxDuration = 60;

function isValidUuid(v: string): boolean {
  return UUID_REGEX.test(v);
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
    .select("id, url, used_in")
    .eq("workspace_id", workspaceId);
  const existingByUrl = new Map<string, { id: string; used_in: string[] }>(
    (existingAssets || []).map((a: { id: string; url: string; used_in: string[] }) => [
      a.url,
      { id: a.id, used_in: a.used_in || [] },
    ])
  );

  let inserted = 0;
  let skipped = 0;
  let updated = 0;

  for (const post of posts || []) {
    const wsId = post.workspace_id || workspaceId;
    const isVideo = post.content_type === "video" || post.content_type === "reel";

    // Collect all image/video URLs for this post
    const entries: { name: string; url: string; fileType: "image" | "video" }[] = [];

    if (post.thumbnail_url && !post.thumbnail_url.startsWith("blob:")) {
      entries.push({
        name: post.title || "Post thumbnail",
        url: post.thumbnail_url,
        fileType: isVideo ? "video" : "image",
      });
    }

    const rawFiles: { name?: string; url?: string; mimeType?: string }[] =
      post.source_vault?.rawFiles || [];
    for (const rf of rawFiles) {
      if (rf.url && !rf.url.startsWith("blob:")) {
        entries.push({
          name: rf.name || "Raw file",
          url: rf.url,
          fileType: rf.mimeType?.startsWith("video") ? "video" : "image",
        });
      }
    }

    for (const entry of entries) {
      const existing = existingByUrl.get(entry.url);

      if (existing) {
        // Row already exists — update used_in if this post isn't already in it
        skipped++;
        if (isValidUuid(post.id) && !existing.used_in.includes(post.id)) {
          const newUsedIn = [...existing.used_in, post.id];
          await admin
            .from("media_assets")
            .update({ used_in: newUsedIn })
            .eq("id", existing.id)
            .eq("workspace_id", workspaceId);
          existingByUrl.set(entry.url, { id: existing.id, used_in: newUsedIn });
          updated++;
        }
        continue;
      }

      // Insert new row
      const usedInArray = isValidUuid(post.id) ? [post.id] : [];
      const { error } = await admin.from("media_assets").insert({
        name: entry.name,
        url: entry.url,
        file_type: entry.fileType,
        folder: "Content Engine Uploads",
        added_by: post.created_by || "System Backfill",
        workspace_id: wsId,
        used_in: usedInArray,
      });

      if (!error) {
        inserted++;
        existingByUrl.set(entry.url, { id: "backfilled", used_in: usedInArray });
      } else {
        console.error("[backfill] insert failed for url", entry.url, error.message);
      }
    }
  }

  return NextResponse.json({
    inserted,
    skipped,
    updated,
    total: (posts || []).length,
    message: `Backfill complete. ${inserted} new, ${skipped} already existed (${updated} had used_in updated), ${(posts || []).length} posts scanned.`,
  });
}
