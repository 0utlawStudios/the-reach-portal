"use client";

import { PreviewImage } from "@/components/preview-image";
import { useState, useMemo, useEffect, useRef } from "react";
import { usePipeline } from "@/lib/pipeline-context";
import { useToast } from "@/lib/toast-context";
import { supabase } from "@/lib/supabaseClient";
import type { RawFile } from "@/lib/types";
import { isDrivePublishableMediaMime, normalizeDriveMimeType } from "@/lib/drive-policy";
import { getPublicDriveDownloadUrl } from "@/lib/drive-url-utils";
import { warmBrowserImagePreview } from "@/lib/image-preview";
import { driveFileIdFromUrl } from "@/lib/media-resolver";
import { videoPreviewFrameUrl } from "@/lib/media-usage";
import { X, Upload, FolderOpen, Image as ImageIcon, Search, CheckCircle, Clock, Link2, ExternalLink } from "lucide-react";
import { PLACEHOLDER_MEDIA } from "@/lib/placeholder-data";
import { useFocusTrap } from "./use-focus-trap";

const ASSET_SOURCES = ["Canva Pro", "Envato Elements", "Pexels", "Shot by Team", "Client Provided", "Google Images", "AI Generated"];
const BASELINE_WORKSPACE_ID = "00000000-0000-0000-0000-000000000001";

function uploadErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "error";
}

function uploadPathForSize(file: File): "proxy" | "resumable" {
  return file.size >= 4 * 1024 * 1024 ? "resumable" : "proxy";
}

function inferAssetMimeType(type: "image" | "video", nameOrUrl: string): string | undefined {
  const inferred = normalizeDriveMimeType(type === "video" ? "video/mp4" : "", nameOrUrl);
  return inferred === "application/octet-stream" ? undefined : inferred;
}

type PickerTab = "upload" | "library";

interface MediaEntry {
  assetId?: string;
  url: string;
  publishUrl?: string;
  driveProxyUrl?: string;
  playbackUrl?: string;
  playbackStorageKey?: string;
  name: string;
  type: "image" | "video";
  mimeType?: string;
  size?: number;
  fileId?: string;
  source?: string;
  usedInCards: { id: string; title: string }[];
}

interface MediaAssetRow {
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
  file_type?: "image" | "video" | null;
  folder?: string | null;
  used_in?: string[] | null;
  workspace_id?: string | null;
}

export interface MediaPickerSelection {
  url: string;
  publishUrl?: string;
  driveProxyUrl?: string;
  playbackUrl?: string;
  playbackStorageKey?: string;
  fileId?: string;
  mediaAssetId?: string;
  name: string;
  mimeType?: string;
  size?: number;
}

interface MediaPickerProps {
  open: boolean;
  onClose: () => void;
  onSelect: (result: MediaPickerSelection) => void;
  onSelectMany?: (results: MediaPickerSelection[]) => void;
  folder?: "thumbnails" | "raw-files" | "media-library";
  cardId?: string;
  defaultTab?: PickerTab;
  allowMultipleUpload?: boolean;
}

function enrichFromRawFile(entry: MediaEntry, file: RawFile) {
  const fileId = file.fileId || driveFileIdFromUrl(file.driveProxyUrl || file.url) || undefined;
  entry.publishUrl = file.publishUrl || (fileId ? getPublicDriveDownloadUrl(fileId) : file.url);
  entry.driveProxyUrl = file.driveProxyUrl || entry.driveProxyUrl;
  entry.playbackUrl = file.playbackUrl || entry.playbackUrl;
  entry.playbackStorageKey = file.playbackStorageKey || entry.playbackStorageKey;
  entry.fileId = fileId || entry.fileId;
  entry.mimeType = file.mimeType || entry.mimeType;
  entry.type = file.mimeType?.startsWith("video") ? "video" : entry.type;
}

function selectionFromAsset(asset: MediaEntry): MediaPickerSelection {
  const fileId = asset.fileId || driveFileIdFromUrl(asset.driveProxyUrl || asset.url) || undefined;
  const publishUrl = asset.publishUrl || (fileId ? getPublicDriveDownloadUrl(fileId) : undefined);
  return {
    url: asset.url,
    publishUrl,
    driveProxyUrl: asset.driveProxyUrl || (driveFileIdFromUrl(asset.url) ? asset.url : undefined),
    playbackUrl: asset.playbackUrl,
    playbackStorageKey: asset.playbackStorageKey,
    fileId,
    mediaAssetId: asset.assetId,
    name: asset.name,
    mimeType: asset.mimeType || inferAssetMimeType(asset.type, asset.name),
  };
}

function mediaDisplayUrl(asset: Pick<MediaEntry, "url" | "driveProxyUrl" | "playbackUrl">): string {
  return asset.playbackUrl || asset.driveProxyUrl || asset.url;
}

export function MediaPicker({
  open,
  onClose,
  onSelect,
  onSelectMany,
  folder = "raw-files",
  cardId,
  defaultTab = "upload",
  allowMultipleUpload = true,
}: MediaPickerProps) {
  const { cards, workspaceId } = usePipeline();
  const { addToast } = useToast();
  const [mediaAssets, setMediaAssets] = useState<MediaAssetRow[]>([]);
  const [tab, setTab] = useState<PickerTab>(defaultTab);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [assetSource, setAssetSource] = useState("");
  const [assetSourceOther, setAssetSourceOther] = useState(false);
  const [search, setSearch] = useState("");
  const [unusedOnly, setUnusedOnly] = useState(false);
  const [selectedAsset, setSelectedAsset] = useState<MediaEntry | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  // Reset tab to defaultTab when picker opens
  useEffect(() => {
    if (open) { setTab(defaultTab); setSelectedAsset(null); }
  }, [open, defaultTab]);

  // ESC closes the picker
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useFocusTrap(dialogRef, open);

  useEffect(() => {
    if (!open) return;
    const wsId = workspaceId || BASELINE_WORKSPACE_ID;
    let cancelled = false;

    supabase
      .from("media_assets")
      .select("id, name, url, file_id, publish_url, drive_proxy_url, playback_url, playback_storage_key, mime_type, size_bytes, file_type, folder, used_in, workspace_id")
      .eq("workspace_id", wsId)
      .order("uploaded_at", { ascending: false })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          console.error("[media-picker] media_assets load failed:", error.message);
          setMediaAssets([]);
          return;
        }
        setMediaAssets((data || []) as MediaAssetRow[]);
      });

    const channel = supabase
      .channel(`media-picker-assets-${wsId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "media_assets", filter: `workspace_id=eq.${wsId}` },
        (payload) => {
          if (payload.eventType === "INSERT") {
            const row = payload.new as MediaAssetRow;
            setMediaAssets((prev) => prev.some((m) => m.id === row.id) ? prev : [row, ...prev]);
          } else if (payload.eventType === "UPDATE") {
            const row = payload.new as MediaAssetRow;
            setMediaAssets((prev) => prev.map((m) => m.id === row.id ? row : m));
          } else if (payload.eventType === "DELETE") {
            const row = payload.old as MediaAssetRow;
            setMediaAssets((prev) => prev.filter((m) => m.id !== row.id));
          }
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [open, workspaceId]);

  // Build media index: accumulate ALL card references per URL
  const allMedia = useMemo(() => {
    const urlMap = new Map<string, MediaEntry>();
    const cardsById = new Map(cards.map((c) => [c.id, c]));

    mediaAssets.forEach((asset) => {
      if (!asset.url) return;
      const fileId = asset.file_id || driveFileIdFromUrl(asset.drive_proxy_url || asset.url) || undefined;
      const usedInCards = (asset.used_in || [])
        .map((id) => cardsById.get(id))
        .filter(Boolean)
        .map((c) => ({ id: c!.id, title: c!.title }));
      urlMap.set(asset.url, {
        assetId: asset.id,
        url: asset.url,
        publishUrl: asset.publish_url || (fileId ? getPublicDriveDownloadUrl(fileId) : undefined),
        driveProxyUrl: asset.drive_proxy_url || (fileId ? asset.url : undefined),
        playbackUrl: asset.playback_url || undefined,
        playbackStorageKey: asset.playback_storage_key || undefined,
        fileId,
        name: asset.name || "Media Library asset",
        type: asset.file_type === "video" ? "video" : "image",
        mimeType: asset.mime_type || inferAssetMimeType(asset.file_type === "video" ? "video" : "image", asset.name || asset.url || ""),
        size: typeof asset.size_bytes === "number" ? asset.size_bytes : undefined,
        usedInCards,
        source: asset.folder || "Media Library",
      });
    });

    cards.forEach((c) => {
      // Thumbnails
      if (c.thumbnailUrl && !c.thumbnailUrl.startsWith("blob:") && !c.thumbnailUrl.startsWith("http://") ) {
        const existing = urlMap.get(c.thumbnailUrl);
        if (existing) {
          if (!existing.usedInCards.find((u) => u.id === c.id)) {
            existing.usedInCards.push({ id: c.id, title: c.title });
          }
        } else {
          urlMap.set(c.thumbnailUrl, {
            url: c.thumbnailUrl,
            name: c.title || "Thumbnail",
            type: "image",
            mimeType: c.sourceVault?.thumbnailMimeType,
            usedInCards: [{ id: c.id, title: c.title }],
          });
        }
      }

      // Raw files (content for publishing)
      c.sourceVault?.rawFiles?.forEach((f) => {
        if (f.url.startsWith("blob:")) return;
        const displayUrl = f.playbackUrl || f.driveProxyUrl || f.url;
        const existing = urlMap.get(displayUrl);
        if (existing) {
          enrichFromRawFile(existing, f);
          if (!existing.usedInCards.find((u) => u.id === c.id)) {
            existing.usedInCards.push({ id: c.id, title: c.title });
          }
        } else {
          urlMap.set(displayUrl, {
            url: displayUrl,
            publishUrl: f.publishUrl || f.url,
            driveProxyUrl: f.driveProxyUrl,
            playbackUrl: f.playbackUrl,
            playbackStorageKey: f.playbackStorageKey,
            name: f.name,
            type: f.mimeType?.startsWith("video") ? "video" : "image",
            mimeType: f.mimeType,
            fileId: f.fileId,
            usedInCards: [{ id: c.id, title: c.title }],
          });
        }
      });
    });

    // Placeholder media (unused by default)
    PLACEHOLDER_MEDIA.forEach((m) => {
      if (!urlMap.has(m.url)) {
        urlMap.set(m.url, { url: m.url, name: m.name, type: m.type, usedInCards: [] });
      }
    });

    return Array.from(urlMap.values());
  }, [cards, mediaAssets]);

  // Filter
  const filteredMedia = useMemo(() => {
    let items = [...allMedia];
    if (unusedOnly) items = items.filter((m) => m.usedInCards.length === 0);
    if (search) items = items.filter((m) => m.name.toLowerCase().includes(search.toLowerCase()));
    return items;
  }, [allMedia, unusedOnly, search]);

  if (!open) return null;

  const handleUpload = async () => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = allowMultipleUpload;
    input.accept = "image/*,video/*,.heic,.heif";
    input.onchange = async (ev) => {
      const selected = Array.from((ev.target as HTMLInputElement).files || []);
      if (selected.length === 0) return;
      if (!assetSource.trim()) { addToast("Asset source is required before uploading", "error"); return; }
      const fileList = selected.filter((file) => isDrivePublishableMediaMime(file.type, file.name));
      if (fileList.length !== selected.length) {
        addToast("This picker only accepts image or video files.", "error");
      }
      if (fileList.length === 0) return;
      setUploading(true);
      setUploadProgress(0);
      let driveModule: typeof import("@/lib/drive-upload") | null = null;
      try {
        driveModule = await import("@/lib/drive-upload");
        const { uploadManyToDrive, reportUploadFailure } = driveModule;
        const items = await uploadManyToDrive(fileList, folder, { cardId, concurrency: 3, onProgress: setUploadProgress });
        const failures = items.filter((item) => item.error || !item.result);
        for (const failure of failures) {
          const errorMessage = uploadErrorMessage(failure.error);
          await reportUploadFailure({
            phase: "media_picker_upload",
            route: "/api/drive/upload-failure",
            uploadPath: uploadPathForSize(failure.file),
            cardId,
            folder,
            fileName: failure.file.name,
            mimeType: normalizeDriveMimeType(failure.file.type, failure.file.name),
            fileSize: failure.file.size,
            batchTotal: fileList.length,
            batchFailed: failures.length,
            errorMessage,
            errorDetail: failure.error instanceof Error ? failure.error.stack : undefined,
          });
          addToast(`Upload failed: ${errorMessage}`, "error");
        }
        const successes = items.filter((item) => item.result);
        const selections: MediaPickerSelection[] = [];
        // Load the playback-optimization module ONCE up front. If its code-split
        // chunk fails to load, videos still upload (they just skip playback
        // optimization) instead of the failure throwing mid-loop and dropping
        // already-uploaded selections that the user expects attached.
        let playbackModule: typeof import("@/lib/media-playback") | null = null;
        try {
          playbackModule = await import("@/lib/media-playback");
        } catch {
          playbackModule = null;
        }
        for (const item of successes) {
          const result = item.result!;
          const mimeType = result.mimeType || normalizeDriveMimeType(item.file.type, item.file.name);
          let playbackUrl: string | undefined;
          let playbackStorageKey: string | undefined;
          if (mimeType.startsWith("video/") && playbackModule) {
            if (playbackModule.canUploadPlaybackCopy(item.file, mimeType)) {
              try {
                const playback = await playbackModule.uploadVideoPlaybackCopy(item.file, cardId);
                playbackUrl = playback.playbackUrl;
                playbackStorageKey = playback.playbackStorageKey;
              } catch (err) {
                const errorMessage = uploadErrorMessage(err);
                await reportUploadFailure({
                  phase: "media_picker_playback_upload",
                  route: "/api/media/playback-upload",
                  uploadPath: uploadPathForSize(item.file),
                  cardId,
                  folder,
                  fileName: item.file.name,
                  mimeType,
                  fileSize: item.file.size,
                  errorMessage,
                  errorDetail: err instanceof Error ? err.stack : undefined,
                });
                addToast(`Uploaded ${item.file.name}, but fast video playback was skipped.`, "warning");
              }
            }
          }
          selections.push({
            url: playbackUrl || result.url,
            publishUrl: result.publishUrl || getPublicDriveDownloadUrl(result.fileId),
            driveProxyUrl: result.driveProxyUrl || result.url,
            playbackUrl,
            playbackStorageKey,
            fileId: result.fileId,
            name: item.file.name,
            mimeType,
            size: result.size || item.file.size,
          });
          warmBrowserImagePreview(result.driveProxyUrl || result.url, { mimeType, fileName: item.file.name });
        }
        if (selections.length > 0) {
          if (onSelectMany) onSelectMany(selections);
          else selections.forEach(onSelect);
        }
        if (selections.length > 0) {
          addToast(selections.length === 1 ? `${selections[0].name} uploaded` : `${selections.length} files uploaded`, "success");
          onClose();
        }
      } catch (err) {
        const errorMessage = uploadErrorMessage(err);
        addToast(`Upload failed: ${errorMessage}. If this keeps happening, refresh the page.`, "error");
        // Best-effort telemetry; guard so it can never strand the finally cleanup.
        try {
          const first = fileList[0];
          await driveModule?.reportUploadFailure({
            phase: "media_picker_upload",
            route: "/api/drive/upload-failure",
            uploadPath: first ? uploadPathForSize(first) : "unknown",
            cardId,
            folder,
            fileName: first?.name,
            mimeType: first ? normalizeDriveMimeType(first.type, first.name) : undefined,
            fileSize: first?.size,
            batchTotal: fileList.length,
            batchFailed: fileList.length,
            errorMessage,
            errorDetail: err instanceof Error ? err.stack : undefined,
          });
        } catch { /* ignore */ }
      } finally { setUploading(false); setUploadProgress(0); }
    };
    input.click();
  };

  const copyShareLink = (asset: MediaEntry) => {
    const siteUrl = typeof window !== "undefined" ? window.location.origin : "";
    const shareUrl = asset.url.startsWith("/") ? `${siteUrl}${asset.url}` : asset.url;
    navigator.clipboard.writeText(shareUrl).then(() => addToast("Link copied. Share with your team.", "success"));
  };

  return (
    <>
      <div onClick={onClose} className="fixed inset-0 bg-black/50 z-[60]" />
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="media-picker-title" className="fixed inset-4 md:inset-8 lg:inset-y-12 lg:inset-x-[12%] z-[60] bg-white dark:bg-[#111] rounded-2xl border border-gray-200 dark:border-white/[0.08] shadow-2xl flex flex-col overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-white/[0.06] shrink-0">
          <h2 id="media-picker-title" className="text-[15px] font-bold text-gray-900 dark:text-white">Select Media</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-white/[0.06] text-gray-400 cursor-pointer"><X className="w-4 h-4" /></button>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-0.5 px-5 border-b border-gray-100 dark:border-white/[0.06] shrink-0">
          {[
            { id: "upload" as PickerTab, label: "Upload New", icon: <Upload className="w-3.5 h-3.5" /> },
            { id: "library" as PickerTab, label: "Media Vault", icon: <FolderOpen className="w-3.5 h-3.5" /> },
          ].map((t) => (
            <button key={t.id} onClick={() => { setTab(t.id); setSelectedAsset(null); }}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-[12px] font-medium border-b-2 -mb-px transition-colors cursor-pointer ${
                tab === t.id ? "border-orange-500 text-orange-600 dark:text-orange-400" : "border-transparent text-gray-400 hover:text-gray-600"
              }`}>
              {t.icon}{t.label}
            </button>
          ))}
        </div>

        <div className="flex-1 flex overflow-hidden">
          {/* Upload Tab */}
          {tab === "upload" && (
            <div className="flex-1 overflow-y-auto p-6 space-y-5 max-w-lg mx-auto">
              <div className="space-y-2">
                <label className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-[0.1em]">Asset Source <span className="text-red-400">*</span></label>
                <select
                  value={assetSourceOther ? "__other__" : assetSource}
                  onChange={(e) => { if (e.target.value === "__other__") { setAssetSourceOther(true); setAssetSource(""); } else { setAssetSourceOther(false); setAssetSource(e.target.value); } }}
                  className="w-full h-10 px-3 rounded-lg bg-gray-50 dark:bg-white/[0.04] border border-gray-200 dark:border-white/[0.08] text-[13px] text-gray-700 dark:text-gray-300 outline-none cursor-pointer focus:border-orange-400 focus:ring-2 focus:ring-orange-100 dark:focus:ring-orange-500/10 transition-all"
                >
                  <option value="">Select source...</option>
                  {ASSET_SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
                  <option value="__other__">Other (specify)</option>
                </select>
                {assetSourceOther && (
                  <input value={assetSource} onChange={(e) => setAssetSource(e.target.value)} placeholder="Specify the source..."
                    className="w-full h-10 px-3 rounded-lg bg-gray-50 dark:bg-white/[0.04] border border-orange-200 dark:border-orange-500/20 text-[13px] text-gray-700 dark:text-gray-300 placeholder:text-gray-400 outline-none focus:border-orange-400 transition-all" autoFocus />
                )}
              </div>
              {uploading && (
                <div className="rounded-xl border border-gray-200/60 dark:border-white/[0.06] p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-medium text-gray-600 dark:text-gray-300">{uploadProgress >= 90 && uploadProgress < 100 ? "Finishing up..." : uploadProgress <= 0 ? "Preparing..." : "Uploading..."}</span>
                    <span className="text-[11px] font-bold text-orange-500 tabular-nums">{uploadProgress}%</span>
                  </div>
                  <div className="w-full h-2 rounded-full bg-gray-100 dark:bg-white/[0.06] overflow-hidden">
                    <div className="h-full rounded-full bg-gradient-to-r from-orange-500 to-amber-500 transition-all duration-300" style={{ width: `${uploadProgress}%` }} />
                  </div>
                </div>
              )}
              {!uploading && (
                <button onClick={handleUpload} disabled={!assetSource.trim()}
                  className="w-full py-12 rounded-2xl border-2 border-dashed border-gray-200 dark:border-white/[0.08] flex flex-col items-center justify-center gap-3 text-gray-400 hover:text-orange-500 hover:border-orange-300 hover:bg-orange-50/20 dark:hover:bg-orange-500/[0.02] transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-gray-400 disabled:hover:border-gray-200">
                  <div className="w-14 h-14 rounded-2xl bg-gray-50 dark:bg-white/[0.04] flex items-center justify-center"><Upload className="w-6 h-6" /></div>
                  <p className="text-[13px] font-medium">{assetSource.trim() ? "Click to select file" : "Select asset source first"}</p>
                  <p className="text-[11px] text-gray-300 dark:text-gray-600">Images and videos, saved to your library</p>
                </button>
              )}
            </div>
          )}

          {/* Library Tab */}
          {tab === "library" && (
            <>
              {/* Grid */}
              <div className={`${selectedAsset ? "flex-1" : "flex-1"} overflow-y-auto p-4 space-y-3`}>
                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-300 dark:text-gray-600" />
                    <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search media..."
                      className="w-full h-9 pl-9 pr-3 rounded-lg bg-gray-50 dark:bg-white/[0.03] border border-gray-100 dark:border-white/[0.06] text-[12px] text-gray-700 dark:text-gray-300 placeholder:text-gray-400 outline-none focus:border-orange-300 transition-all" />
                  </div>
                  <button onClick={() => setUnusedOnly(!unusedOnly)}
                    className={`h-9 px-3 rounded-lg text-[11px] font-medium border transition-all cursor-pointer shrink-0 ${unusedOnly ? "bg-emerald-50 border-emerald-200 text-emerald-700 dark:bg-emerald-500/10 dark:border-emerald-500/20 dark:text-emerald-400" : "bg-white border-gray-200 text-gray-500 dark:bg-transparent dark:border-white/[0.08] dark:text-gray-400"}`}>
                    {unusedOnly ? "Unused Only" : "All Assets"}
                  </button>
                  <span className="text-[10px] text-gray-400 tabular-nums shrink-0">{filteredMedia.length}</span>
                </div>

                {filteredMedia.length > 0 ? (
                  <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2">
                    {filteredMedia.map((asset, i) => {
                      const isSelected = selectedAsset?.url === asset.url;
                      return (
                        <button key={i} onClick={() => setSelectedAsset(asset)}
                          className={`group relative aspect-square rounded-xl overflow-hidden border-2 transition-all cursor-pointer bg-gray-50 dark:bg-white/[0.03] ${isSelected ? "border-orange-500 ring-2 ring-orange-200 dark:ring-orange-500/20" : "border-transparent hover:border-orange-400"}`}>
                          {asset.type === "image" ? (
                            <PreviewImage src={mediaDisplayUrl(asset)} alt={asset.name} mimeType={asset.mimeType} fileName={asset.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200" />
                          ) : (
                            <video
                              src={videoPreviewFrameUrl(mediaDisplayUrl(asset))}
                              muted
                              playsInline
                              preload="metadata"
                              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200 bg-black"
                              aria-label={`${asset.name} video preview`}
                            />
                          )}
                          <div className="absolute top-1.5 left-1.5">
                            {asset.usedInCards.length > 0 ? (
                              <span className="text-[7px] px-1.5 py-0.5 rounded-full bg-emerald-500/90 text-white font-bold flex items-center gap-0.5"><CheckCircle className="w-2 h-2" />{asset.usedInCards.length} post{asset.usedInCards.length > 1 ? "s" : ""}</span>
                            ) : (
                              <span className="text-[7px] px-1.5 py-0.5 rounded-full bg-gray-500/70 text-white font-bold flex items-center gap-0.5"><Clock className="w-2 h-2" />Free</span>
                            )}
                          </div>
                          <div className="absolute bottom-0 left-0 right-0 bg-black/60 backdrop-blur-sm px-1.5 py-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <p className="text-[8px] text-white truncate">{asset.name}</p>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="text-center py-12">
                    <ImageIcon className="w-8 h-8 text-gray-300 dark:text-gray-600 mx-auto mb-2" />
                    <p className="text-[13px] text-gray-400">No matching assets</p>
                  </div>
                )}
              </div>

              {/* Detail panel (right side) */}
              {selectedAsset && (
                <div className="w-[280px] border-l border-gray-100 dark:border-white/[0.06] bg-gray-50/50 dark:bg-white/[0.02] p-4 overflow-y-auto shrink-0 space-y-4">
                  {/* Preview */}
                  <div className="rounded-xl overflow-hidden bg-white dark:bg-white/[0.03] border border-gray-200/60 dark:border-white/[0.06] shadow-sm">
                    {selectedAsset.type === "image" ? (
                      <PreviewImage src={mediaDisplayUrl(selectedAsset)} alt={selectedAsset.name} mimeType={selectedAsset.mimeType} fileName={selectedAsset.name} className="w-full aspect-video object-cover" />
                    ) : (
                      <video
                        src={mediaDisplayUrl(selectedAsset)}
                        controls
                        playsInline
                        preload="metadata"
                        className="w-full aspect-video object-contain bg-black"
                        aria-label={`${selectedAsset.name} video preview`}
                      />
                    )}
                  </div>

                  {/* Name */}
                  <div>
                    <p className="text-[9px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-[0.1em] mb-1">File Name</p>
                    <p className="text-[12px] font-medium text-gray-700 dark:text-gray-300 break-all">{selectedAsset.name}</p>
                  </div>

                  {/* Share link */}
                  <button onClick={() => copyShareLink(selectedAsset)}
                    className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-white dark:bg-white/[0.03] border border-gray-200 dark:border-white/[0.06] hover:border-orange-300 dark:hover:border-orange-500/20 transition-colors cursor-pointer text-left">
                    <Link2 className="w-3.5 h-3.5 text-orange-500 shrink-0" />
                    <span className="text-[11px] text-gray-600 dark:text-gray-400 font-medium">Copy shareable link</span>
                  </button>

                  {/* Used in posts */}
                  <div>
                    <p className="text-[9px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-[0.1em] mb-2">Used In ({selectedAsset.usedInCards.length})</p>
                    {selectedAsset.usedInCards.length > 0 ? (
                      <div className="space-y-1.5">
                        {selectedAsset.usedInCards.map((card) => (
                          <div key={card.id} className="flex items-center gap-2 px-2.5 py-2 rounded-lg bg-white dark:bg-white/[0.03] border border-gray-100 dark:border-white/[0.05]">
                            <div className="w-1.5 h-1.5 rounded-full bg-orange-500 shrink-0" />
                            <span className="text-[11px] text-gray-600 dark:text-gray-400 truncate flex-1">{card.title}</span>
                            <ExternalLink className="w-2.5 h-2.5 text-gray-300 shrink-0" />
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-[11px] text-gray-400 italic">Not used in any post yet</p>
                    )}
                  </div>

                  {/* Select button */}
                  <button onClick={() => {
                    const selection = selectionFromAsset(selectedAsset);
                    if (folder === "raw-files" && selectedAsset.type === "video" && !selection.publishUrl) {
                      addToast("This video is missing its Drive publishing source. Re-upload it before using it as post content.", "error");
                      return;
                    }
                    onSelect(selection);
                    onClose();
                  }}
                    className="reach-action-button w-full h-10 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-[13px] font-semibold shadow-sm cursor-pointer transition-colors">
                    Use This Asset
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
