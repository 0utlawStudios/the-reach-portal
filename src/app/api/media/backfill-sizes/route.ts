import { NextRequest, NextResponse } from "next/server";
import { ALLOWED_DRIVE_ROLES } from "@/lib/drive-policy";
import { getFileMetadata } from "@/lib/google-drive";
import { requireBearerTeamRole } from "@/lib/auth/require";
import { buildMediaSizeMetadataUpdate, driveFileIdForSizeBackfillRow, type MediaSizeBackfillRow } from "@/lib/media-size-backfill";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { isValidUuid } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_ROWS = 75;

type BackfillResult = {
  id: string;
  status: "updated" | "skipped" | "failed";
  sizeBytes?: number;
  mimeType?: string;
  name?: string;
  reason?: string;
};

function validRequestedIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const ids = value.filter((id): id is string => typeof id === "string" && isValidUuid(id));
  return [...new Set(ids)].slice(0, MAX_ROWS);
}

export async function POST(request: NextRequest) {
  const auth = await requireBearerTeamRole(request, ALLOWED_DRIVE_ROLES);
  if (auth instanceof NextResponse) return auth;

  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  const requestedIds = validRequestedIds((body as { mediaAssetIds?: unknown } | null)?.mediaAssetIds);

  const admin = createServiceRoleClient();
  let query = admin
    .from("media_assets")
    .select("id, name, url, file_id, publish_url, drive_proxy_url, playback_url, mime_type, size_bytes")
    .eq("workspace_id", auth.workspaceId)
    .or("size_bytes.is.null,size_bytes.lte.0")
    .limit(MAX_ROWS);
  if (requestedIds.length > 0) {
    query = query.in("id", requestedIds);
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const results: BackfillResult[] = [];
  for (const row of (data || []) as MediaSizeBackfillRow[]) {
    const fileId = driveFileIdForSizeBackfillRow(row);
    if (!fileId) {
      results.push({ id: row.id, status: "skipped", reason: "Missing Drive file ID" });
      continue;
    }
    try {
      const meta = await getFileMetadata(fileId);
      const metadataUpdate = await buildMediaSizeMetadataUpdate(row, meta, auth.workspaceId, fileId);
      if (!metadataUpdate) {
        results.push({ id: row.id, status: "skipped", reason: "Drive file is not trusted for this workspace" });
        continue;
      }
      const { data: updated, error: updateError } = await admin
        .from("media_assets")
        .update(metadataUpdate)
        .eq("id", row.id)
        .eq("workspace_id", auth.workspaceId)
        .select("id, name, mime_type, size_bytes")
        .maybeSingle();
      if (updateError || !updated) {
        results.push({ id: row.id, status: "failed", reason: updateError?.message || "No matching workspace row was updated" });
        continue;
      }
      const typed = updated as { id: string; name?: string | null; mime_type?: string | null; size_bytes?: number | null };
      results.push({
        id: typed.id,
        status: "updated",
        sizeBytes: typeof typed.size_bytes === "number" ? typed.size_bytes : undefined,
        mimeType: typed.mime_type || undefined,
        name: typed.name || undefined,
      });
    } catch (err) {
      results.push({ id: row.id, status: "failed", reason: err instanceof Error ? err.message : "Drive metadata lookup failed" });
    }
  }

  return NextResponse.json({
    results,
    updated: results.filter((result) => result.status === "updated").length,
    skipped: results.filter((result) => result.status === "skipped").length,
    failed: results.filter((result) => result.status === "failed").length,
  }, { headers: { "Cache-Control": "no-store" } });
}
