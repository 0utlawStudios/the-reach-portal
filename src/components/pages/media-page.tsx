"use client";

import { PreviewImage } from "@/components/preview-image";
import { MediaVideo } from "@/components/media-video";
import { OptimizedAvatar } from "@/components/optimized-avatar";
import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { ContentCard, MediaAsset } from "@/lib/types";
import { usePipeline } from "@/lib/pipeline-context";
import { useAuth } from "@/lib/auth-context";
import { useTeam } from "@/lib/team-context";
import { useToast } from "@/lib/toast-context";
import { supabase } from "@/lib/supabaseClient";
import { ensureMediaAsset } from "@/lib/media-assets";
import {
  getAutomaticMediaUsage,
  hasManualUsedTag,
  MEDIA_MANUAL_USED_TAG,
  mediaAssetAliases,
  sameUsedIn,
  stripPrivateMediaToken,
  syncedUsedInValue,
  videoPreviewFrameUrl,
} from "@/lib/media-usage";
import { isDrivePublishableMediaMime, normalizeDriveMimeType } from "@/lib/drive-policy";
import { browserImagePreviewUrl, warmBrowserImagePreview } from "@/lib/image-preview";
import { resolveViewableMediaUrl } from "@/lib/media-view-url";
import { formatDateShort, formatDateTimeCompact } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  FolderOpen, Upload, Film, Image as ImageIcon, Search, Grid3X3, List,
  CheckCircle, Clock, X, Trash2, Eye, Link2, ExternalLink,
  ChevronLeft, ChevronRight, Tag, Play,
} from "lucide-react";

type StatusFilter = "all" | "unused" | "inuse";
const BASELINE_WORKSPACE_ID = "00000000-0000-0000-0000-000000000001";
type AssetUsage = {
  cards: ContentCard[];
  automaticCards: ContentCard[];
  manual: boolean;
  used: boolean;
  source: "automatic" | "manual" | "unused";
};
type MediaAssetRow = {
  id?: string;
  name?: string;
  url?: string;
  file_id?: string | null;
  publish_url?: string | null;
  drive_proxy_url?: string | null;
  playback_url?: string | null;
  playback_storage_key?: string | null;
  mime_type?: string | null;
  size_bytes?: number | null;
  file_type?: MediaAsset["type"];
  folder?: string | null;
  uploaded_at?: string | null;
  added_by?: string | null;
  used_in?: string[] | null;
  workspace_id?: string | null;
};

function isSupabaseConfigured(): boolean {
  return !!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

function dbToAsset(row: MediaAssetRow): MediaAsset {
  return {
    id: row.id || crypto.randomUUID(),
    name: row.name || "Untitled asset",
    url: row.url || "",
    fileId: row.file_id || undefined,
    publishUrl: row.publish_url || undefined,
    driveProxyUrl: row.drive_proxy_url || undefined,
    playbackUrl: row.playback_url || undefined,
    playbackStorageKey: row.playback_storage_key || undefined,
    mimeType: row.mime_type || undefined,
    size: typeof row.size_bytes === "number" ? row.size_bytes : undefined,
    type: row.file_type || "image",
    folder: row.folder || "Uploads",
    uploadedAt: row.uploaded_at || new Date().toISOString(),
    addedBy: row.added_by || undefined,
    usedIn: row.used_in || undefined,
  };
}

function mediaAssetsOverlap(a: MediaAsset, b: MediaAsset): boolean {
  const aliases = mediaAssetAliases(a);
  for (const alias of mediaAssetAliases(b)) {
    if (aliases.has(alias)) return true;
  }
  return false;
}

function upsertMediaAsset(prev: MediaAsset[], asset: MediaAsset): MediaAsset[] {
  const index = prev.findIndex((existing) => mediaAssetsOverlap(existing, asset));
  if (index === -1) return [asset, ...prev];
  const next = [...prev];
  next[index] = { ...next[index], ...asset };
  return next;
}

function uploadErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "upload failed";
}

function uploadPathForSize(file: File): "proxy" | "resumable" {
  return file.size >= 4 * 1024 * 1024 ? "resumable" : "proxy";
}

function mediaDisplayUrl(asset: Pick<MediaAsset, "url" | "driveProxyUrl" | "playbackUrl">): string {
  return stripPrivateMediaToken(asset.playbackUrl || asset.driveProxyUrl || asset.url);
}

// For a video cell we show Drive's generated poster frame (a cached image) instead of a live
// video element that re-fetches every refresh. Use the Drive stream URL (it carries the file
// id) so the poster route can resolve it; skip playbackUrl (a Supabase key with no Drive id).
function videoPosterUrl(asset: Pick<MediaAsset, "url" | "driveProxyUrl">): string {
  return stripPrivateMediaToken(asset.driveProxyUrl || asset.url);
}

// Human-readable file size. Returns null for missing/zero so legacy rows render nothing
// instead of "0 MB" (size_bytes only exists from migration 0052 and is null on old rows).
function formatFileSize(bytes?: number): string | null {
  if (!bytes || !Number.isFinite(bytes) || bytes <= 0) return null;
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function mediaVideoSources(asset: Pick<MediaAsset, "url" | "driveProxyUrl" | "playbackUrl">, previewFrame = false): string[] {
  const sources = [asset.playbackUrl, asset.driveProxyUrl, asset.url]
    .map((url) => stripPrivateMediaToken(url))
    .filter((url): url is string => Boolean(url));
  return previewFrame ? sources.map(videoPreviewFrameUrl) : sources;
}

function browserViewUrl(asset: Pick<MediaAsset, "url" | "driveProxyUrl" | "playbackUrl" | "mimeType" | "name">): string {
  return browserImagePreviewUrl(mediaDisplayUrl(asset), { mimeType: asset.mimeType, fileName: asset.name, size: "full" });
}

function absoluteAppUrl(url: string): string {
  const siteUrl = typeof window !== "undefined" ? window.location.origin : "";
  return url.startsWith("/") ? `${siteUrl}${url}` : url;
}

export function MediaPage() {
  const { cards, workspaceId } = usePipeline();
  const { currentUser } = useAuth();
  const { members } = useTeam();
  // Map an asset's free-text "added by" name to that member's real profile photo.
  // Best-effort: new uploads store currentUser.name, which matches a member exactly;
  // legacy/seed names that don't match fall back to initials via OptimizedAvatar.
  const memberAvatarByName = useMemo(() => {
    const map = new Map<string, string>();
    for (const member of members) {
      if (member.name && member.avatar) map.set(member.name.trim().toLowerCase(), member.avatar);
    }
    return map;
  }, [members]);
  const avatarForAddedBy = useCallback(
    (addedBy?: string) => (addedBy ? memberAvatarByName.get(addedBy.trim().toLowerCase()) : undefined),
    [memberAvatarByName],
  );
  const { addToast } = useToast();
  const [media, setMedia] = useState<MediaAsset[]>([]);
  const [mediaLoadError, setMediaLoadError] = useState<string | null>(null);
  const [mediaReloadNonce, setMediaReloadNonce] = useState(0);
  const [activeFolder, setActiveFolder] = useState<string>("all");
  const [activeType, setActiveType] = useState<"all" | "image" | "video">("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [viewMode, setViewMode] = useState<"grid" | "list">("list");
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [lightboxAsset, setLightboxAsset] = useState<MediaAsset | null>(null);
  // Videos in the lightbox start as a poster (click to play) so a large iPhone .mov no longer
  // auto-spins a black box on open; the bytes load only when the user actually hits play.
  const [lightboxVideoPlaying, setLightboxVideoPlaying] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadingFileName, setUploadingFileName] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const warmedPreviewKeysRef = useRef<Set<string>>(new Set());
  const useDb = isSupabaseConfigured();

  // ─── Load media from Supabase ───
  useEffect(() => {
    if (!useDb) return;
    const wsId = workspaceId || BASELINE_WORKSPACE_ID;
    supabase
      .from("media_assets")
      .select("*")
      .eq("workspace_id", wsId)
      .order("uploaded_at", { ascending: false })
      .then(({ data, error }) => {
        if (error) {
          console.error("[media] media_assets load failed:", error.message);
          setMediaLoadError(error.message);
          addToast("Media Library couldn't refresh. Showing the last loaded files.", "error");
          return;
        }
        setMediaLoadError(null);
        setMedia((data || []).map(dbToAsset));
      });
  }, [addToast, mediaReloadNonce, useDb, workspaceId]);

  // Realtime subscription — keeps media library in sync with DB inserts/updates/deletes
  useEffect(() => {
    if (!useDb) return;
    const wsId = workspaceId || BASELINE_WORKSPACE_ID;

    const channel = supabase
      .channel(`media-assets-realtime-${wsId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "media_assets", filter: `workspace_id=eq.${wsId}` },
        (payload) => {
          const newAsset = dbToAsset(payload.new as MediaAssetRow);
          setMedia((prev) => upsertMediaAsset(prev, newAsset));
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "media_assets", filter: `workspace_id=eq.${wsId}` },
        (payload) => {
          const updated = dbToAsset(payload.new as MediaAssetRow);
          setMedia((prev) => upsertMediaAsset(prev, updated));
        }
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "media_assets", filter: `workspace_id=eq.${wsId}` },
        (payload) => {
          const deletedId = (payload.old as Partial<MediaAssetRow>).id;
          if (deletedId) {
            setMedia((prev) => prev.filter((m) => m.id !== deletedId));
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [useDb, workspaceId]);

  const folders = useMemo(() => Array.from(new Set(media.map((m) => m.folder))).sort(), [media]);

  const usageByAssetId = useMemo(() => {
    const usage = new Map<string, AssetUsage>();
    for (const asset of media) {
      const automaticCards = getAutomaticMediaUsage(asset, cards);
      const manual = hasManualUsedTag(asset.usedIn);
      const used = automaticCards.length > 0 || manual;
      usage.set(asset.id, {
        automaticCards,
        cards: automaticCards,
        manual,
        used,
        source: automaticCards.length > 0 ? "automatic" : manual ? "manual" : "unused",
      });
    }
    return usage;
  }, [media, cards]);

  const filteredMedia = useMemo(() => {
    let items = [...media];
    if (activeFolder !== "all") items = items.filter((m) => m.folder === activeFolder);
    if (activeType !== "all") items = items.filter((m) => m.type === activeType);
    if (statusFilter === "unused") items = items.filter((m) => !usageByAssetId.get(m.id)?.used);
    if (statusFilter === "inuse") items = items.filter((m) => usageByAssetId.get(m.id)?.used);
    if (search) items = items.filter((m) => m.name.toLowerCase().includes(search.toLowerCase()));
    return items.sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
  }, [media, activeFolder, activeType, statusFilter, search, usageByAssetId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      for (const asset of filteredMedia.slice(0, viewMode === "grid" ? 36 : 24)) {
        if (asset.type !== "image") continue;
        const url = mediaDisplayUrl(asset);
        const key = `${asset.id}:${url}:thumb`;
        if (warmedPreviewKeysRef.current.has(key)) continue;
        warmedPreviewKeysRef.current.add(key);
        warmBrowserImagePreview(url, { mimeType: asset.mimeType, fileName: asset.name, size: "thumb" });
      }
    }, 150);
    return () => window.clearTimeout(timer);
  }, [filteredMedia, viewMode]);

  useEffect(() => {
    if (!useDb || media.length === 0) return;
    const wsId = workspaceId || BASELINE_WORKSPACE_ID;
    for (const asset of media) {
      const usage = usageByAssetId.get(asset.id);
      const nextUsedIn = syncedUsedInValue(asset.usedIn, usage?.automaticCards || []);
      if (sameUsedIn(asset.usedIn, nextUsedIn)) continue;

      supabase
        .from("media_assets")
        .update({ used_in: nextUsedIn })
        .eq("id", asset.id)
        .eq("workspace_id", wsId)
        .select("id")
        .maybeSingle()
        .then(({ data, error }) => {
          if (!error && data) return;
          if (!error) {
            console.error("[media] automatic used_in sync failed: no matching workspace row was updated");
            return;
          }
          console.error("[media] automatic used_in sync failed:", error.message);
        });
    }
  }, [useDb, media, usageByAssetId, workspaceId]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || uploading) return;
    const selectedFiles = Array.from(files);
    const fileList = selectedFiles.filter((file) => isDrivePublishableMediaMime(file.type, file.name));
    if (fileList.length !== selectedFiles.length) {
      addToast("Media Library uploads must be images or videos. Add documents in Source Vault.", "error");
    }
    if (fileList.length === 0) {
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    setUploading(true);
    setUploadingFileName(fileList.length === 1 ? fileList[0].name : `Uploading ${fileList.length} files`);
    setUploadProgress(0);

    // The dynamic import lives INSIDE the try. If its code-split chunk fails to
    // load — e.g. a stale chunk hash after a deploy, a network blip, or an
    // ad-blocker — the catch + finally below reset the UI instead of leaving it
    // stuck on "Preparing…" forever (the exact reported production symptom).
    let driveModule: typeof import("@/lib/drive-upload") | null = null;
    try {
      driveModule = await import("@/lib/drive-upload");
      const { reportUploadFailure, uploadManyToDrive } = driveModule;
      // Upload all files concurrently (3-wide pool) instead of one-at-a-time.
      const items = await uploadManyToDrive(fileList, "media-library", {
        workspaceId,
        concurrency: 3,
        onProgress: setUploadProgress,
      });

      const failures = items.filter((it) => it.error || !it.result);
      if (failures.length > 0) {
        const first = failures[0];
        await reportUploadFailure({
          phase: "media_library_batch_upload",
          route: "/api/drive/upload-failure",
          uploadPath: uploadPathForSize(first.file),
          folder: "media-library",
          workspaceId,
          fileName: first.file.name,
          mimeType: normalizeDriveMimeType(first.file.type, first.file.name),
          fileSize: first.file.size,
          batchTotal: fileList.length,
          batchFailed: failures.length,
          errorMessage: uploadErrorMessage(first.error),
          errorDetail: first.error?.stack,
        });
      }

      const playbackOptimizations: Array<() => Promise<void>> = [];

      // A direct Media Library upload is not complete until the DB row exists.
      // Optional video playback copies stay best-effort after that durable row.
      for (const it of items) {
        const file = it.file;
        if (it.error || !it.result) {
          addToast(`Couldn't upload ${file.name}: ${uploadErrorMessage(it.error)}`, "error");
          continue;
        }
        const result = it.result;
        const mimeType = result.mimeType || normalizeDriveMimeType(file.type, file.name);
        const driveProxyUrl = result.driveProxyUrl || result.url;
        const asset: MediaAsset = {
          id: `m-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          name: file.name,
          url: driveProxyUrl,
          fileId: result.fileId,
          publishUrl: result.publishUrl,
          driveProxyUrl,
          mimeType,
          size: result.size || file.size,
          type: mimeType.startsWith("video") ? "video" : "image",
          folder: "Media Library",
          uploadedAt: new Date().toISOString(),
          addedBy: currentUser.name,
        };
        warmBrowserImagePreview(asset.driveProxyUrl || asset.url, { mimeType: asset.mimeType, fileName: asset.name });

        if (useDb) {
          try {
            asset.id = await ensureMediaAsset({
              name: asset.name,
              url: asset.url,
              fileId: asset.fileId,
              publishUrl: asset.publishUrl,
              driveProxyUrl: asset.driveProxyUrl,
              mimeType: asset.mimeType,
              size: asset.size,
              fileType: asset.type,
              folder: asset.folder,
              addedBy: asset.addedBy || currentUser.name,
              workspaceId: workspaceId || BASELINE_WORKSPACE_ID,
            });
          } catch (err) {
            console.error("[media] upload library insert failed:", err);
            addToast(`Uploaded ${file.name}, but saving to Media Library failed. Try again before closing this page.`, "error");
            await reportUploadFailure({
              phase: "media_library_media_asset_sync",
              route: "/api/drive/upload-failure",
              uploadPath: uploadPathForSize(file),
              folder: "media-library",
              workspaceId,
              fileName: file.name,
              mimeType,
              fileSize: file.size,
              errorMessage: uploadErrorMessage(err),
              errorDetail: err instanceof Error ? err.stack : undefined,
            });
            continue;
          }
        }

        if (mimeType.startsWith("video/")) {
          playbackOptimizations.push(async () => {
            try {
              const playbackModule = await import("@/lib/media-playback");
              if (!playbackModule.canUploadPlaybackCopy(file, mimeType)) return;
              const playback = await playbackModule.uploadVideoPlaybackCopy(file, "media-library", workspaceId);
              const updatedAsset: MediaAsset = {
                ...asset,
                url: playback.playbackUrl,
                playbackUrl: playback.playbackUrl,
                playbackStorageKey: playback.playbackStorageKey,
              };
              setMedia((prev) => prev.map((existing) => (
                mediaAssetsOverlap(existing, asset) ? { ...existing, ...updatedAsset } : existing
              )));
              if (useDb) {
                const id = await ensureMediaAsset({
                  name: asset.name,
                  url: playback.playbackUrl,
                  fileId: asset.fileId,
                  publishUrl: asset.publishUrl,
                  driveProxyUrl: asset.driveProxyUrl,
                  playbackUrl: playback.playbackUrl,
                  playbackStorageKey: playback.playbackStorageKey,
                  mimeType,
                  size: asset.size,
                  fileType: "video",
                  folder: asset.folder,
                  addedBy: asset.addedBy || currentUser.name,
                  workspaceId: workspaceId || BASELINE_WORKSPACE_ID,
                });
                setMedia((prev) => prev.map((existing) => (
                  mediaAssetsOverlap(existing, updatedAsset) ? { ...existing, id } : existing
                )));
              }
            } catch (playbackErr) {
              await reportUploadFailure({
                phase: "media_library_playback_upload",
                route: "/api/media/playback-upload",
                uploadPath: uploadPathForSize(file),
                folder: "media-library",
                workspaceId,
                fileName: file.name,
                mimeType,
                fileSize: file.size,
                errorMessage: uploadErrorMessage(playbackErr),
                errorDetail: playbackErr instanceof Error ? playbackErr.stack : undefined,
              });
              addToast(`Uploaded ${file.name}, but fast video playback was skipped.`, "warning");
            }
          });
        }

        setMedia((prev) => upsertMediaAsset(prev, asset));
        addToast(`${file.name} saved to Media Library`, "success");
      }
      if (playbackOptimizations.length > 0) {
        void Promise.allSettled(playbackOptimizations.map((run) => run()));
      }
    } catch (err) {
      addToast(`Upload failed: ${uploadErrorMessage(err)}. If this keeps happening, refresh the page.`, "error");
      // Best-effort telemetry. driveModule is null when the import itself failed;
      // guard so a reporting failure can never strand the finally cleanup below.
      try {
        const first = fileList[0];
        await driveModule?.reportUploadFailure({
          phase: "media_library_upload_exception",
          route: "/api/drive/upload-failure",
          uploadPath: first ? uploadPathForSize(first) : "unknown",
          folder: "media-library",
          workspaceId,
          fileName: first?.name,
          mimeType: first ? normalizeDriveMimeType(first.type, first.name) : undefined,
          fileSize: first?.size,
          batchTotal: fileList.length,
          batchFailed: fileList.length,
          errorMessage: uploadErrorMessage(err),
          errorDetail: err instanceof Error ? err.stack : undefined,
        });
      } catch { /* telemetry must never block recovery */ }
    } finally {
      // ALWAYS runs — even if the import or an unexpected throw happened above —
      // so the upload UI can never get stuck on "Preparing…".
      if (fileInputRef.current) fileInputRef.current.value = "";
      setUploading(false);
      setUploadProgress(0);
      setUploadingFileName("");
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  };

  // UX-009: deletes are confirmed via a dialog first; confirmDeleteSelected
  // runs the actual removal. DATA-008: the Supabase delete error is inspected
  // and the removed assets are re-inserted locally on failure.
  const confirmDeleteSelected = () => {
    const idsToDelete = Array.from(selectedIds);
    const removedAssets = media.filter((m) => selectedIds.has(m.id));
    setMedia((prev) => prev.filter((m) => !selectedIds.has(m.id)));
    setSelectedIds(new Set());
    setConfirmingDelete(false);
    // Delete via the server route, which owns BOTH Drive cleanup (trash + strip public
    // access) and the DB row removal. The browser no longer deletes media_assets
    // directly, so a deleted asset's Drive file no longer orphans forever. Fail-closed:
    // any id the server did not confirm "deleted" is restored to the board.
    if (useDb && idsToDelete.length > 0) {
      const wsId = workspaceId || BASELINE_WORKSPACE_ID;
      const restore = (ids: string[]) => {
        const restoreSet = new Set(ids);
        const toRestore = removedAssets.filter((a) => restoreSet.has(a.id));
        if (toRestore.length === 0) return;
        setMedia((prev) => {
          const present = new Set(prev.map((m) => m.id));
          const missing = toRestore.filter((a) => !present.has(a.id));
          return missing.length > 0 ? [...missing, ...prev] : prev;
        });
      };
      void (async () => {
        try {
          const { data: sessionData } = await supabase.auth.getSession();
          const token = sessionData.session?.access_token;
          const res = await fetch("/api/drive/delete-media", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
              "X-Workspace-Id": wsId,
            },
            body: JSON.stringify({ mediaAssetIds: idsToDelete }),
          });
          if (!res.ok) {
            restore(idsToDelete);
            addToast("Delete failed. Files were restored.", "error");
            return;
          }
          const data = await res.json();
          const results: Array<{ mediaAssetId: string; status: string; error?: string }> = Array.isArray(data.results) ? data.results : [];
          const deletedIds = new Set(results.filter((r) => r.status === "deleted").map((r) => r.mediaAssetId));
          const notDeleted = idsToDelete.filter((id) => !deletedIds.has(id));
          if (notDeleted.length > 0) {
            restore(notDeleted);
            // Surface the server's specific reason when it's the "still in use" guard, since
            // that is actionable (remove from the post first) rather than a transient error.
            const inUse = results.filter((r) => r.status === "failed" && /still used by/i.test(r.error || ""));
            const message = inUse.length > 0
              ? `${inUse.length} ${inUse.length === 1 ? "file is" : "files are"} still used by a post and ${inUse.length === 1 ? "was" : "were"} kept. Remove ${inUse.length === 1 ? "it" : "them"} from the post first.`
              : deletedIds.size > 0
                ? "Some files couldn't be deleted and were restored."
                : "Delete failed. Files were restored.";
            addToast(message, "error");
          }
        } catch (err) {
          console.error("[media] deleteSelected route failed:", err instanceof Error ? err.message : err);
          restore(idsToDelete);
          addToast("Delete failed. Files were restored.", "error");
        }
      })();
    }
  };

  const getUsageInfo = (asset: MediaAsset) => usageByAssetId.get(asset.id) || null;

  // Selected assets that a post automatically uses. Deleting these is now refused by the
  // server (it would trash the shared Drive file the post streams), so warn before the user
  // confirms — the In-use badge alone was easy to miss in a multi-select.
  const selectedInUseByPosts = useMemo(
    () => media.filter((m) => selectedIds.has(m.id) && (usageByAssetId.get(m.id)?.automaticCards.length || 0) > 0),
    [media, selectedIds, usageByAssetId],
  );

  const toggleManualUsed = useCallback((asset: MediaAsset) => {
    const current = asset.usedIn || [];
    const usage = usageByAssetId.get(asset.id);
    const next = new Set(syncedUsedInValue(current, usage?.automaticCards || []));
    const nextManual = !hasManualUsedTag(current);
    if (nextManual) next.add(MEDIA_MANUAL_USED_TAG);
    else next.delete(MEDIA_MANUAL_USED_TAG);
    const nextUsedIn = Array.from(next).sort();
    if (sameUsedIn(current, nextUsedIn)) return;

    setMedia((prev) => prev.map((m) => (m.id === asset.id ? { ...m, usedIn: nextUsedIn } : m)));
    if (!useDb) {
      addToast(nextManual ? "Marked as used locally." : "Manual used tag cleared locally.", "success");
      return;
    }

    supabase
      .from("media_assets")
      .update({ used_in: nextUsedIn })
      .eq("id", asset.id)
      .eq("workspace_id", workspaceId || BASELINE_WORKSPACE_ID)
      .select("id")
      .maybeSingle()
      .then(({ data, error }) => {
        if (!error && data) {
          addToast(nextManual ? "Marked as used." : "Manual used tag cleared.", "success");
          return;
        }
        if (!error) {
          console.error("[media] manual used tag update failed: no matching workspace row was updated");
          setMedia((prev) => prev.map((m) => (m.id === asset.id ? { ...m, usedIn: current } : m)));
          addToast("Tag update failed: no matching library row was updated.", "error");
          return;
        }
        console.error("[media] manual used tag update failed:", error.message);
        setMedia((prev) => prev.map((m) => (m.id === asset.id ? { ...m, usedIn: current } : m)));
        addToast(`Tag update failed: ${error.message}`, "error");
      });
  }, [addToast, useDb, usageByAssetId, workspaceId]);

  const copyShareLink = async (asset: MediaAsset) => {
    try {
      const sourceUrl = asset.type === "image" ? browserViewUrl(asset) : mediaDisplayUrl(asset);
      const shareUrl = absoluteAppUrl(await resolveViewableMediaUrl(sourceUrl));
      await navigator.clipboard.writeText(shareUrl);
      addToast(`Link copied for "${asset.name}"`, "success");
    } catch {
      addToast(`Could not copy a viewable link for "${asset.name}". Try opening it first.`, "error");
    }
  };

  const openInNewTab = async (asset: MediaAsset) => {
    const popup = window.open("about:blank", "_blank", "noopener,noreferrer");
    try {
      const sourceUrl = asset.type === "image" ? browserViewUrl(asset) : mediaDisplayUrl(asset);
      const viewableUrl = absoluteAppUrl(await resolveViewableMediaUrl(sourceUrl));
      if (popup) {
        popup.location.href = viewableUrl;
        return;
      }
      const opened = window.open(viewableUrl, "_blank", "noopener,noreferrer");
      if (!opened) addToast("Your browser blocked the new tab.", "error");
    } catch {
      if (popup) popup.close();
      addToast(`Could not open "${asset.name}".`, "error");
    }
  };

  // ─── Lightbox navigation ───
  const lightboxIndex = lightboxAsset ? filteredMedia.findIndex((m) => m.id === lightboxAsset.id) : -1;
  const hasPrev = lightboxIndex > 0;
  const hasNext = lightboxIndex >= 0 && lightboxIndex < filteredMedia.length - 1;

  useEffect(() => {
    if (!lightboxAsset || lightboxAsset.type !== "image") return;
    const currentUrl = mediaDisplayUrl(lightboxAsset);
    warmBrowserImagePreview(currentUrl, { mimeType: lightboxAsset.mimeType, fileName: lightboxAsset.name });

    for (const neighbor of [filteredMedia[lightboxIndex - 1], filteredMedia[lightboxIndex + 1]]) {
      if (!neighbor || neighbor.type !== "image") continue;
      warmBrowserImagePreview(mediaDisplayUrl(neighbor), { mimeType: neighbor.mimeType, fileName: neighbor.name, size: "thumb" });
    }
  }, [filteredMedia, lightboxAsset, lightboxIndex]);

  // Reset to the poster whenever the lightbox opens a different asset (open, prev/next, swipe).
  useEffect(() => {
    setLightboxVideoPlaying(false);
  }, [lightboxAsset?.id]);

  useEffect(() => {
    if (!lightboxAsset) return;
    const idx = filteredMedia.findIndex((m) => m.id === lightboxAsset.id);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft" && idx > 0) setLightboxAsset(filteredMedia[idx - 1]);
      else if (e.key === "ArrowRight" && idx < filteredMedia.length - 1) setLightboxAsset(filteredMedia[idx + 1]);
      else if (e.key === "Escape") setLightboxAsset(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightboxAsset, filteredMedia]);

  const onSwipeStart = (e: React.TouchEvent) => {
    touchStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  };
  const onSwipeEnd = (e: React.TouchEvent) => {
    if (!touchStartRef.current || !lightboxAsset) return;
    const dx = e.changedTouches[0].clientX - touchStartRef.current.x;
    const dy = e.changedTouches[0].clientY - touchStartRef.current.y;
    touchStartRef.current = null;
    const idx = filteredMedia.findIndex((m) => m.id === lightboxAsset.id);
    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 50) {
      if (dx < 0 && idx < filteredMedia.length - 1) setLightboxAsset(filteredMedia[idx + 1]);
      else if (dx > 0 && idx > 0) setLightboxAsset(filteredMedia[idx - 1]);
    } else if (dy > 80) {
      setLightboxAsset(null);
    }
  };

  return (
    <div className="flex h-full flex-col md:flex-row">
      {/* Sidebar */}
      <div className="relative w-full md:w-[200px] border-b md:border-b-0 md:border-r border-gray-100 dark:border-white/[0.06] bg-white dark:bg-[#111] p-3 flex md:flex-col shrink-0 overflow-x-auto md:overflow-x-visible gap-1 md:gap-0">
        {/* UX-021: mobile-only right-edge fade hints at horizontal scroll */}
        <div className="absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-white dark:from-[#111] to-transparent pointer-events-none md:hidden" />
        <h2 className="hidden md:block text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-[0.08em] px-2 mb-3">Media Library</h2>
        <div className="hidden md:block px-2 mb-3 space-y-1">
          <div className="flex gap-2">
            <span className="text-[9px] text-gray-400 flex items-center gap-1"><ImageIcon className="w-2.5 h-2.5" />{media.filter((m) => m.type === "image").length}</span>
            <span className="text-[9px] text-gray-400 flex items-center gap-1"><Film className="w-2.5 h-2.5" />{media.filter((m) => m.type === "video").length}</span>
            <span className="text-[9px] text-gray-400 ml-auto">{media.length} total</span>
          </div>
        </div>
        <div className="flex md:flex-col gap-0.5 md:space-y-0.5 md:flex-1 md:overflow-y-auto">
          <button onClick={() => setActiveFolder("all")} className={`whitespace-nowrap md:w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-[12px] font-medium cursor-pointer transition-colors ${activeFolder === "all" ? "bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-400" : "text-gray-500 hover:bg-gray-50 dark:text-gray-400 dark:hover:bg-white/[0.04]"}`}>
            <Grid3X3 className="w-3.5 h-3.5 shrink-0" />All<span className="hidden md:inline ml-auto text-[10px] text-gray-400">{media.length}</span>
          </button>
          {folders.map((folder) => (
            <button key={folder} onClick={() => setActiveFolder(folder)} className={`whitespace-nowrap md:w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-[12px] font-medium cursor-pointer transition-colors ${activeFolder === folder ? "bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-400" : "text-gray-500 hover:bg-gray-50 dark:text-gray-400 dark:hover:bg-white/[0.04]"}`}>
              <FolderOpen className="w-3.5 h-3.5 shrink-0" />{folder}<span className="hidden md:inline ml-auto text-[10px] text-gray-400">{media.filter((m) => m.folder === folder).length}</span>
            </button>
          ))}
        </div>
        <input ref={fileInputRef} type="file" multiple accept="image/*,video/*,.heic,.heif" onChange={handleUpload} className="hidden" />
        <button disabled={uploading} onClick={() => fileInputRef.current?.click()} className="reach-action-button hidden md:flex mt-2 w-full items-center justify-center gap-2 h-9 rounded-lg bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 text-white text-[11px] font-medium cursor-pointer shadow-sm transition-all duration-200 disabled:opacity-40">
          <Upload className="w-3.5 h-3.5" />{uploading ? "Uploading..." : "Upload Files"}
        </button>
      </div>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-gray-100 dark:border-white/[0.06] bg-white dark:bg-[#111] shrink-0">
          <div className="relative flex-1 min-w-[150px] max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search files..." className="h-8 pl-9 bg-gray-50 dark:bg-white/[0.04] border-gray-200 dark:border-white/[0.08] rounded-lg text-[11px]" />
          </div>

          {/* Status filter tabs */}
          <div className="flex items-center gap-0.5 bg-gray-100 dark:bg-white/[0.04] rounded-lg p-0.5">
            {([["all", "All Files"], ["inuse", "In Use"], ["unused", "Unused"]] as const).map(([val, label]) => (
              <button key={val} onClick={() => setStatusFilter(val)}
                className={`px-2.5 py-1 rounded-md text-[10px] font-medium cursor-pointer transition-all duration-200 ${statusFilter === val ? "bg-white dark:bg-[#151518] text-gray-800 dark:text-white shadow-sm" : "text-gray-500 hover:text-gray-700"}`}>
                {label}
              </button>
            ))}
          </div>

          {/* Type filter */}
          <div className="hidden sm:flex items-center gap-1 border-l border-gray-200 dark:border-white/[0.06] pl-2">
            {([["all", "All"], ["image", "Images"], ["video", "Videos"]] as const).map(([val, label]) => (
              <button key={val} onClick={() => setActiveType(val)} className={`px-2.5 py-1 rounded-md text-[10px] font-medium cursor-pointer transition-all duration-200 ${activeType === val ? "bg-gray-900 text-white dark:bg-white dark:text-gray-900" : "text-gray-500 hover:bg-gray-50"}`}>{label}</button>
            ))}
          </div>

          {/* View toggle — UX-012: visible on mobile too so users stuck in
              the wide list view can switch back to grid. */}
          <div className="flex items-center gap-0.5 border-l border-gray-200 dark:border-white/[0.06] pl-2">
            <button onClick={() => setViewMode("grid")} aria-label="Grid view" className={`p-1.5 rounded-md cursor-pointer transition-all duration-200 ${viewMode === "grid" ? "bg-gray-100 dark:bg-white/[0.08] text-gray-700 dark:text-white" : "text-gray-400"}`}><Grid3X3 className="w-3.5 h-3.5" /></button>
            <button onClick={() => setViewMode("list")} aria-label="List view" className={`p-1.5 rounded-md cursor-pointer transition-all duration-200 ${viewMode === "list" ? "bg-gray-100 dark:bg-white/[0.08] text-gray-700 dark:text-white" : "text-gray-400"}`}><List className="w-3.5 h-3.5" /></button>
          </div>

          {selectedIds.size > 0 && (
            <div className="flex items-center gap-2 border-l border-gray-200 dark:border-white/[0.06] pl-2">
              <span className="text-[10px] text-gray-500">{selectedIds.size} selected</span>
              <button onClick={() => setConfirmingDelete(true)} className="text-[10px] text-red-500 cursor-pointer font-medium flex items-center gap-1"><Trash2 className="w-3 h-3" />Delete</button>
              <button onClick={() => setSelectedIds(new Set())} className="text-gray-400 cursor-pointer"><X className="w-3.5 h-3.5" /></button>
            </div>
          )}

          <span className="ml-auto text-[10px] text-gray-400 hidden sm:block">{filteredMedia.length} files</span>
          {/* Mobile upload */}
          <button disabled={uploading} onClick={() => fileInputRef.current?.click()} className="reach-action-button md:hidden p-2 rounded-lg bg-orange-500 text-white cursor-pointer disabled:opacity-40"><Upload className="w-4 h-4" /></button>
        </div>

        {/* Upload progress */}
        {uploading && (
          <div className="px-4 py-3 border-b border-gray-100 dark:border-white/[0.06] bg-white dark:bg-[#111] shrink-0">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[11px] font-medium text-gray-600 dark:text-gray-300 truncate">{uploadingFileName}</span>
              <span className="text-[11px] font-bold text-orange-500 tabular-nums ml-2">{uploadProgress >= 90 && uploadProgress < 100 ? "Finishing up..." : uploadProgress <= 0 ? "Preparing..." : uploadProgress + "%"}</span>
            </div>
            <div className="w-full h-1.5 rounded-full bg-gray-100 dark:bg-white/[0.06] overflow-hidden">
              <div className="h-full rounded-full bg-gradient-to-r from-orange-500 to-amber-500 transition-all duration-300" style={{ width: `${uploadProgress}%` }} />
            </div>
          </div>
        )}

        {mediaLoadError && (
          <div className="mx-4 mt-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-900 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-200">
            <span className="min-w-0 flex-1">Media Library could not refresh. Last loaded files are still shown.</span>
            <button
              type="button"
              onClick={() => setMediaReloadNonce((value) => value + 1)}
              className="rounded-md border border-amber-300/70 px-2 py-1 font-medium text-amber-950 transition-colors hover:bg-amber-100 dark:border-amber-400/30 dark:text-amber-100 dark:hover:bg-amber-400/10"
            >
              Retry
            </button>
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {filteredMedia.length > 0 ? (
            viewMode === "grid" ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                {filteredMedia.map((asset) => {
                  const selected = selectedIds.has(asset.id);
                  const usage = getUsageInfo(asset);
                  return (
                    <div key={asset.id} className={`group relative rounded-xl overflow-hidden cursor-pointer transition-all duration-200 ${selected ? "ring-2 ring-blue-500 ring-offset-2 dark:ring-offset-[#0a0a0a]" : "border border-gray-200/70 dark:border-white/[0.06] hover:border-gray-300 hover:shadow-md"} bg-white dark:bg-[#151518] shadow-sm`}>
                      <div onClick={() => setLightboxAsset(asset)} className="relative aspect-square overflow-hidden bg-gray-50 dark:bg-white/[0.03]">
                        {asset.type === "image" ? (
                          <PreviewImage src={mediaDisplayUrl(asset)} alt={asset.name} mimeType={asset.mimeType} fileName={asset.name} className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105" />
                        ) : (
                          <>
                            <PreviewImage
                              src={videoPosterUrl(asset)}
                              alt={asset.name}
                              mimeType={asset.mimeType}
                              fileName={asset.name}
                              fallbackIcon="video"
                              className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                            />
                            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-black/45 backdrop-blur-sm">
                                <Play className="h-4 w-4 text-white fill-white translate-x-px" />
                              </span>
                            </div>
                          </>
                        )}
                        <div className="absolute top-2 right-2 px-1.5 py-0.5 rounded-md bg-black/50 backdrop-blur-sm text-[8px] text-white font-medium uppercase">{asset.type}</div>
                        {usage?.used ? (
                          <div className="absolute top-2 left-2 px-1.5 py-0.5 rounded-md bg-emerald-500/90 text-[8px] text-white font-medium flex items-center gap-0.5">
                            <CheckCircle className="w-2.5 h-2.5" />{usage.source === "manual" ? "Manual" : "In use"}
                          </div>
                        ) : (
                          <div className="absolute top-2 left-2 px-1.5 py-0.5 rounded-md bg-gray-500/70 text-[8px] text-white font-medium flex items-center gap-0.5"><Clock className="w-2.5 h-2.5" />Unused</div>
                        )}
                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-all duration-200 flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100">
                          <button onClick={(e) => { e.stopPropagation(); void copyShareLink(asset); }} className="w-8 h-8 rounded-full bg-white/90 flex items-center justify-center shadow-lg hover:bg-white transition-colors" title="Copy link"><Link2 className="w-3.5 h-3.5 text-gray-700" /></button>
                          <div className="w-8 h-8 rounded-full bg-white/90 flex items-center justify-center shadow-lg"><Eye className="w-3.5 h-3.5 text-gray-700" /></div>
                          {(!usage?.used || usage.source === "manual") && (
                            <button
                              onClick={(e) => { e.stopPropagation(); toggleManualUsed(asset); }}
                              className="w-8 h-8 rounded-full bg-white/90 flex items-center justify-center shadow-lg hover:bg-white transition-colors"
                              title={usage?.manual ? "Clear manual used tag" : "Mark used manually"}
                            >
                              <Tag className="w-3.5 h-3.5 text-gray-700" />
                            </button>
                          )}
                          <button onClick={(e) => { e.stopPropagation(); void openInNewTab(asset); }} className="w-8 h-8 rounded-full bg-white/90 flex items-center justify-center shadow-lg hover:bg-white transition-colors" title="Open"><ExternalLink className="w-3.5 h-3.5 text-gray-700" /></button>
                        </div>
                      </div>
                      <button onClick={(e) => { e.stopPropagation(); toggleSelect(asset.id); }} className={`absolute top-2 right-2 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all duration-200 ${selected ? "bg-blue-500 border-blue-500" : "border-white/80 bg-black/20 opacity-0 group-hover:opacity-100"}`}>
                        {selected && <CheckCircle className="w-3 h-3 text-white" />}
                      </button>
                      <div className="p-2.5">
                        <p className="text-[11px] font-medium text-gray-700 dark:text-gray-300 truncate">{asset.name}</p>
                        {formatFileSize(asset.size) && (
                          <p className="text-[9px] text-gray-400 dark:text-gray-500 tabular-nums mt-0.5">{formatFileSize(asset.size)}</p>
                        )}
                        <div className="flex items-center justify-between mt-1">
                          <span className="text-[9px] text-gray-400 flex items-center gap-1 min-w-0">
                            {asset.addedBy && (
                              <OptimizedAvatar
                                src={avatarForAddedBy(asset.addedBy)}
                                name={asset.addedBy}
                                width={16}
                                height={16}
                                className="w-4 h-4 rounded-full object-cover shrink-0"
                                fallbackClassName="w-4 h-4 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-[6px] font-bold text-white shrink-0"
                              />
                            )}
                            <span className="truncate">{asset.addedBy}</span>
                          </span>
                          <span className="text-[9px] text-gray-400 shrink-0">{formatDateShort(asset.uploadedAt)}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="overflow-x-auto -mx-4 px-4">
                <div className="bg-white dark:bg-[#151518] rounded-xl border border-gray-100 dark:border-white/[0.06] overflow-hidden shadow-sm min-w-[760px]">
                  <div className="grid grid-cols-[minmax(0,1fr)_80px_100px_130px_80px_140px] items-center gap-2 px-4 py-2.5 border-b border-gray-100 dark:border-white/[0.06] text-[9px] font-bold text-gray-400 uppercase tracking-wider">
                    <div>File</div><div>Type</div><div>Folder</div><div>Status</div><div>Added By</div><div>Timestamp</div>
                  </div>
                  {filteredMedia.map((asset) => {
                    const usage = getUsageInfo(asset);
                    const selected = selectedIds.has(asset.id);
                    return (
                      <div key={asset.id}
                        className={`grid grid-cols-[minmax(0,1fr)_80px_100px_130px_80px_140px] items-center gap-2 px-4 py-2.5 border-b border-gray-50 dark:border-white/[0.03] last:border-0 hover:bg-slate-50 dark:hover:bg-white/[0.02] cursor-pointer transition-all duration-150 ${selected ? "bg-blue-50/50 dark:bg-blue-500/5" : ""}`}>
                        <div className="flex items-center gap-2.5 min-w-0" onClick={() => setLightboxAsset(asset)}>
                          <button onClick={(e) => { e.stopPropagation(); toggleSelect(asset.id); }}
                            className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-all duration-200 ${selected ? "bg-blue-500 border-blue-500" : "border-gray-300 dark:border-gray-600 hover:border-blue-400"}`}>
                            {selected && <CheckCircle className="w-3 h-3 text-white" />}
                          </button>
                          <div className="w-8 h-8 rounded-lg overflow-hidden bg-gray-100 dark:bg-white/[0.04] shrink-0">
                            {asset.type === "image" ? (
                              <PreviewImage src={mediaDisplayUrl(asset)} alt="" mimeType={asset.mimeType} fileName={asset.name} className="w-full h-full object-cover" />
                            ) : (
                              <PreviewImage
                                src={videoPosterUrl(asset)}
                                alt={asset.name}
                                mimeType={asset.mimeType}
                                fileName={asset.name}
                                fallbackIcon="video"
                                className="w-full h-full object-cover"
                              />
                            )}
                          </div>
                          <div className="min-w-0">
                            <p className="text-[11px] font-medium text-gray-700 dark:text-gray-300 break-words">{asset.name}</p>
                            {formatFileSize(asset.size) && (
                              <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5 tabular-nums">{formatFileSize(asset.size)}</p>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center">
                          <Badge variant="outline" className={`text-[9px] h-[18px] px-1.5 ${asset.type === "video" ? "text-purple-600 border-purple-200 bg-purple-50 dark:bg-purple-500/10 dark:text-purple-400 dark:border-purple-500/20" : "text-blue-600 border-blue-200 bg-blue-50 dark:bg-blue-500/10 dark:text-blue-400 dark:border-blue-500/20"}`}>
                            {asset.type === "video" ? <Film className="w-2.5 h-2.5 mr-0.5" /> : <ImageIcon className="w-2.5 h-2.5 mr-0.5" />}{asset.type}
                          </Badge>
                        </div>
                        <div className="flex items-center text-[10px] text-gray-500 dark:text-gray-400">{asset.folder}</div>
                        <div className="flex items-center gap-1.5">
                          {usage?.used ? (
                            <Badge variant="outline" className="text-[9px] h-[18px] px-1.5 text-emerald-600 border-emerald-200 bg-emerald-50 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/20">
                              <CheckCircle className="w-2.5 h-2.5 mr-0.5" />{usage.source === "manual" ? "Manual" : "In use"}
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-[9px] h-[18px] px-1.5 text-gray-500 border-gray-200 bg-gray-50 dark:bg-white/[0.04] dark:text-gray-400 dark:border-white/[0.08]"><Clock className="w-2.5 h-2.5 mr-0.5" />Unused</Badge>
                          )}
                          {(!usage?.used || usage.source === "manual") && (
                            <button
                              onClick={(e) => { e.stopPropagation(); toggleManualUsed(asset); }}
                              className="h-[18px] px-1.5 rounded-md border border-gray-200 dark:border-white/[0.08] text-[9px] font-medium text-gray-500 hover:text-orange-600 hover:border-orange-300 dark:hover:text-orange-400 dark:hover:border-orange-500/30 transition-colors"
                              title={usage?.manual ? "Clear manual used tag" : "Mark used manually"}
                            >
                              {usage?.manual ? "Clear" : "Mark"}
                            </button>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5">
                          {asset.addedBy && (
                            <>
                              <OptimizedAvatar
                                src={avatarForAddedBy(asset.addedBy)}
                                name={asset.addedBy}
                                width={20}
                                height={20}
                                className="w-5 h-5 rounded-full object-cover shrink-0"
                                fallbackClassName="w-5 h-5 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-[7px] font-bold text-white shrink-0"
                              />
                              <span className="text-[10px] text-gray-600 dark:text-gray-400 font-medium truncate">{asset.addedBy}</span>
                            </>
                          )}
                        </div>
                        <div className="flex items-center text-[10px] text-gray-400 tabular-nums">{formatDateTimeCompact(asset.uploadedAt)}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )
          ) : (
            <div className="flex flex-col items-center justify-center h-full py-16">
              <FolderOpen className="w-10 h-10 text-gray-300 dark:text-gray-600 mb-3" />
              <p className="text-[14px] text-gray-500 font-medium">No files found</p>
              <p className="text-[11px] text-gray-400 mt-1">Upload files or adjust your filters</p>
            </div>
          )}
        </div>
      </div>

      {/* Lightbox */}
      {lightboxAsset && (
        <>
          <div onClick={() => setLightboxAsset(null)} className="fixed inset-0 bg-black/70 z-50 backdrop-blur-sm" />
          <div className="fixed inset-4 sm:inset-8 md:inset-16 z-50 flex items-center justify-center">
            <div className="relative bg-white dark:bg-[#151518] rounded-2xl overflow-hidden shadow-2xl max-w-3xl w-full max-h-full flex flex-col">
              <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-white/[0.06]">
                <div>
                  <p className="text-[13px] font-medium text-gray-800 dark:text-gray-200">{lightboxAsset.name}</p>
                  <p className="text-[10px] text-gray-400">{lightboxAsset.folder} · {formatDateTimeCompact(lightboxAsset.uploadedAt)}{lightboxAsset.addedBy ? ` · by ${lightboxAsset.addedBy}` : ""}</p>
                  {filteredMedia.length > 1 && <p className="text-[9px] text-gray-400 tabular-nums mt-0.5">{lightboxIndex + 1} of {filteredMedia.length}</p>}
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={() => void copyShareLink(lightboxAsset)} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-white/[0.06] text-gray-400 hover:text-orange-500 cursor-pointer transition-colors" title="Copy shareable link"><Link2 className="w-4 h-4" /></button>
                  <button onClick={() => void openInNewTab(lightboxAsset)} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-white/[0.06] text-gray-400 hover:text-blue-500 cursor-pointer transition-colors" title="Open in new tab"><ExternalLink className="w-4 h-4" /></button>
                  <button onClick={() => setLightboxAsset(null)} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-white/[0.06] text-gray-400 cursor-pointer transition-colors"><X className="w-5 h-5" /></button>
                </div>
              </div>
              <div className="flex-1 overflow-hidden bg-gray-50 dark:bg-black flex items-center justify-center p-4 relative group/lb" onTouchStart={onSwipeStart} onTouchEnd={onSwipeEnd}>
                {lightboxAsset.type === "image" ? (
                  <PreviewImage src={mediaDisplayUrl(lightboxAsset)} alt={lightboxAsset.name} mimeType={lightboxAsset.mimeType} fileName={lightboxAsset.name} className="w-full h-[60vh] max-w-full max-h-[60vh] object-contain rounded-lg select-none" draggable={false} />
                ) : lightboxVideoPlaying ? (
                  <MediaVideo sources={mediaVideoSources(lightboxAsset)} controls autoPlay playsInline preload="auto" loadTimeoutMs={15000} className="max-w-full max-h-[60vh] object-contain rounded-lg bg-black" label={`${lightboxAsset.name} video preview`} />
                ) : (
                  <button
                    type="button"
                    onClick={() => setLightboxVideoPlaying(true)}
                    aria-label={`Play ${lightboxAsset.name}`}
                    className="relative w-full h-[60vh] max-w-full max-h-[60vh] flex items-center justify-center rounded-lg overflow-hidden bg-black cursor-pointer"
                  >
                    <PreviewImage src={videoPosterUrl(lightboxAsset)} alt={lightboxAsset.name} mimeType={lightboxAsset.mimeType} fileName={lightboxAsset.name} fallbackIcon="video" className="w-full h-full object-cover" />
                    <span className="absolute inset-0 flex items-center justify-center">
                      <span className="flex h-16 w-16 items-center justify-center rounded-full bg-black/55 backdrop-blur-sm ring-1 ring-white/20">
                        <Play className="h-7 w-7 text-white fill-white translate-x-0.5" />
                      </span>
                    </span>
                  </button>
                )}
                {hasPrev && (
                  <button onClick={() => setLightboxAsset(filteredMedia[lightboxIndex - 1])} className="absolute left-2 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-black/40 backdrop-blur-sm flex items-center justify-center text-white hover:bg-black/60 transition-all cursor-pointer shadow-lg opacity-70 md:opacity-0 md:group-hover/lb:opacity-100">
                    <ChevronLeft className="w-5 h-5" />
                  </button>
                )}
                {hasNext && (
                  <button onClick={() => setLightboxAsset(filteredMedia[lightboxIndex + 1])} className="absolute right-2 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-black/40 backdrop-blur-sm flex items-center justify-center text-white hover:bg-black/60 transition-all cursor-pointer shadow-lg opacity-70 md:opacity-0 md:group-hover/lb:opacity-100">
                    <ChevronRight className="w-5 h-5" />
                  </button>
                )}
              </div>
            </div>
          </div>
        </>
      )}

      {/* ─── Delete Confirmation Dialog (UX-009) ─── */}
      {confirmingDelete && selectedIds.size > 0 && (
        <>
          <div onClick={() => setConfirmingDelete(false)} className="fixed inset-0 bg-black/40 dark:bg-black/60 z-[100] backdrop-blur-sm" />
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6" onClick={() => setConfirmingDelete(false)}>
            <div
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="delete-media-title"
              aria-describedby="delete-media-desc"
              className="w-full max-w-md sm:max-w-lg rounded-2xl overflow-hidden bg-white/85 dark:bg-[#18181b]/85 backdrop-blur-2xl border border-gray-200/60 dark:border-white/[0.12] shadow-[0_8px_32px_rgba(0,0,0,0.12)] dark:shadow-[0_8px_32px_rgba(0,0,0,0.5)]"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-200/40 dark:border-white/[0.08]">
                <div className="w-9 h-9 rounded-xl bg-red-500/10 dark:bg-red-500/15 flex items-center justify-center shrink-0">
                  <Trash2 className="w-5 h-5 text-red-500" aria-hidden="true" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 id="delete-media-title" className="text-[15px] font-bold text-gray-900 dark:text-white">
                    Delete {selectedIds.size} {selectedIds.size === 1 ? "file" : "files"}?
                  </h3>
                </div>
                <button onClick={() => setConfirmingDelete(false)} aria-label="Cancel delete" className="p-1.5 rounded-lg hover:bg-gray-100/80 dark:hover:bg-white/[0.06] text-gray-400 cursor-pointer transition-colors">
                  <X className="w-4 h-4" aria-hidden="true" />
                </button>
              </div>
              <div className="px-5 py-4 space-y-2.5">
                <p id="delete-media-desc" className="text-[13px] text-gray-700 dark:text-gray-300 leading-relaxed">
                  This removes {selectedIds.size === 1 ? "this file" : `these ${selectedIds.size} files`} from the media library. This cannot be undone.
                </p>
                {selectedInUseByPosts.length > 0 && (
                  <p className="text-[12.5px] text-amber-700 dark:text-amber-400 leading-relaxed bg-amber-500/10 dark:bg-amber-500/[0.08] border border-amber-500/20 rounded-lg px-3 py-2">
                    {selectedInUseByPosts.length === 1 ? "1 file is" : `${selectedInUseByPosts.length} files are`} still used by a post and will be kept. Remove {selectedInUseByPosts.length === 1 ? "it" : "them"} from the post first to delete.
                  </p>
                )}
              </div>
              <div className="px-5 py-4 border-t border-gray-200/40 dark:border-white/[0.08] flex gap-2">
                <button onClick={() => setConfirmingDelete(false)} className="flex-1 h-10 rounded-xl border border-gray-200 dark:border-white/[0.1] text-[13px] font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/[0.04] cursor-pointer transition-colors">
                  Cancel
                </button>
                <button onClick={confirmDeleteSelected} className="flex-1 h-10 rounded-xl bg-red-600 hover:bg-red-700 text-white text-[13px] font-medium cursor-pointer shadow-sm shadow-red-500/20 transition-colors flex items-center justify-center gap-1.5">
                  <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                  Delete {selectedIds.size === 1 ? "File" : "Files"}
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
