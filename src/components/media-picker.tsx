"use client";

import { useState, useRef } from "react";
import { usePipeline } from "@/lib/pipeline-context";
import { useToast } from "@/lib/toast-context";
import { X, Upload, FolderOpen, Image as ImageIcon, Film, FileText, Search, CheckCircle, Clock } from "lucide-react";
import { PLACEHOLDER_MEDIA } from "@/lib/placeholder-data";
import { MediaAsset } from "@/lib/types";

const ASSET_SOURCES = ["Envato Elements", "Pexels", "Shot by Team", "Client Provided", "Google Images", "AI Generated"];

type PickerTab = "upload" | "library";

interface MediaPickerProps {
  open: boolean;
  onClose: () => void;
  onSelect: (result: { url: string; fileId?: string; name: string; mimeType?: string; size?: number }) => void;
  folder?: "thumbnails" | "raw-files" | "media-library";
  cardId?: string;
}

export function MediaPicker({ open, onClose, onSelect, folder = "raw-files", cardId }: MediaPickerProps) {
  const { cards } = usePipeline();
  const { addToast } = useToast();
  const [tab, setTab] = useState<PickerTab>("upload");
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [assetSource, setAssetSource] = useState("");
  const [assetSourceOther, setAssetSourceOther] = useState(false);
  const [search, setSearch] = useState("");
  const [unusedOnly, setUnusedOnly] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!open) return null;

  // Collect all existing media: card thumbnails + rawFiles + placeholder media
  const allMedia: { url: string; name: string; type: "image" | "video"; source?: string; usedIn?: string[] }[] = [];
  const seenUrls = new Set<string>();

  // From cards
  cards.forEach((c) => {
    if (c.thumbnailUrl && !c.thumbnailUrl.startsWith("blob:") && !seenUrls.has(c.thumbnailUrl)) {
      seenUrls.add(c.thumbnailUrl);
      allMedia.push({ url: c.thumbnailUrl, name: c.title || "Card thumbnail", type: "image", usedIn: [c.id] });
    }
    c.sourceVault?.rawFiles?.forEach((f) => {
      if (!f.url.startsWith("blob:") && !seenUrls.has(f.url)) {
        seenUrls.add(f.url);
        allMedia.push({ url: f.url, name: f.name, type: f.mimeType?.startsWith("video") ? "video" : "image", usedIn: [c.id] });
      }
    });
  });

  // From placeholder media
  PLACEHOLDER_MEDIA.forEach((m) => {
    if (!seenUrls.has(m.url)) {
      seenUrls.add(m.url);
      allMedia.push({ url: m.url, name: m.name, type: m.type, usedIn: m.usedIn });
    }
  });

  // Filter
  let filteredMedia = [...allMedia];
  if (unusedOnly) filteredMedia = filteredMedia.filter((m) => !m.usedIn || m.usedIn.length === 0);
  if (search) filteredMedia = filteredMedia.filter((m) => m.name.toLowerCase().includes(search.toLowerCase()));

  const handleUpload = async () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*,video/*";
    input.onchange = async (ev) => {
      const file = (ev.target as HTMLInputElement).files?.[0];
      if (!file) return;

      // Compliance gate: require asset source
      if (!assetSource.trim()) {
        addToast("Asset source is required before uploading", "error");
        return;
      }

      setUploading(true);
      setUploadProgress(0);
      try {
        const { uploadToDrive } = await import("@/lib/drive-upload");
        const result = await uploadToDrive(file, folder, cardId, setUploadProgress);
        onSelect({
          url: result.url,
          fileId: result.fileId,
          name: file.name,
          mimeType: result.mimeType || file.type,
          size: result.size || file.size,
        });
        addToast(`${file.name} uploaded`, "success");
        onClose();
      } catch (err) {
        addToast(`Upload failed: ${err instanceof Error ? err.message : "error"}`, "error");
      } finally {
        setUploading(false);
        setUploadProgress(0);
      }
    };
    input.click();
  };

  return (
    <>
      <div onClick={onClose} className="fixed inset-0 bg-black/50 z-[60]" />
      <div className="fixed inset-4 md:inset-8 lg:inset-y-12 lg:inset-x-[15%] z-[60] bg-white dark:bg-[#111] rounded-2xl border border-gray-200 dark:border-white/[0.08] shadow-2xl flex flex-col overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-white/[0.06] shrink-0">
          <h2 className="text-[15px] font-bold text-gray-900 dark:text-white">Select Media</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-white/[0.06] text-gray-400 cursor-pointer"><X className="w-4 h-4" /></button>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-0.5 px-5 border-b border-gray-100 dark:border-white/[0.06] shrink-0">
          {[
            { id: "upload" as PickerTab, label: "Upload New", icon: <Upload className="w-3.5 h-3.5" /> },
            { id: "library" as PickerTab, label: "Media Vault", icon: <FolderOpen className="w-3.5 h-3.5" /> },
          ].map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-[12px] font-medium border-b-2 -mb-px transition-colors cursor-pointer ${
                tab === t.id ? "border-orange-500 text-orange-600 dark:text-orange-400" : "border-transparent text-gray-400 hover:text-gray-600"
              }`}>
              {t.icon}{t.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">

          {/* Upload Tab */}
          {tab === "upload" && (
            <div className="p-6 space-y-5 max-w-lg mx-auto">
              {/* Asset Source — required */}
              <div className="space-y-2">
                <label className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-[0.1em]">
                  Asset Source <span className="text-red-400">*</span>
                </label>
                <select
                  value={assetSourceOther ? "__other__" : assetSource}
                  onChange={(e) => {
                    if (e.target.value === "__other__") { setAssetSourceOther(true); setAssetSource(""); }
                    else { setAssetSourceOther(false); setAssetSource(e.target.value); }
                  }}
                  className="w-full h-10 px-3 rounded-lg bg-gray-50 dark:bg-white/[0.04] border border-gray-200 dark:border-white/[0.08] text-[13px] text-gray-700 dark:text-gray-300 outline-none cursor-pointer focus:border-orange-400 focus:ring-2 focus:ring-orange-100 dark:focus:ring-orange-500/10 transition-all"
                >
                  <option value="">Select source...</option>
                  {ASSET_SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
                  <option value="__other__">Other (specify)</option>
                </select>
                {assetSourceOther && (
                  <input
                    value={assetSource}
                    onChange={(e) => setAssetSource(e.target.value)}
                    placeholder="Specify the source..."
                    className="w-full h-10 px-3 rounded-lg bg-gray-50 dark:bg-white/[0.04] border border-orange-200 dark:border-orange-500/20 text-[13px] text-gray-700 dark:text-gray-300 placeholder:text-gray-400 outline-none focus:border-orange-400 transition-all"
                    autoFocus
                  />
                )}
              </div>

              {/* Upload progress */}
              {uploading && (
                <div className="bg-white dark:bg-white/[0.03] rounded-xl border border-gray-200/60 dark:border-white/[0.06] p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-medium text-gray-600 dark:text-gray-300">Uploading...</span>
                    <span className="text-[11px] font-bold text-orange-500 tabular-nums">{uploadProgress}%</span>
                  </div>
                  <div className="w-full h-2 rounded-full bg-gray-100 dark:bg-white/[0.06] overflow-hidden">
                    <div className="h-full rounded-full bg-gradient-to-r from-orange-500 to-amber-500 transition-all duration-300" style={{ width: `${uploadProgress}%` }} />
                  </div>
                </div>
              )}

              {/* Upload dropzone */}
              {!uploading && (
                <button
                  onClick={handleUpload}
                  disabled={!assetSource.trim()}
                  className="w-full py-12 rounded-2xl border-2 border-dashed border-gray-200 dark:border-white/[0.08] flex flex-col items-center justify-center gap-3 text-gray-400 dark:text-gray-500 hover:text-orange-500 hover:border-orange-300 dark:hover:border-orange-500/30 hover:bg-orange-50/20 dark:hover:bg-orange-500/[0.02] transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-gray-400 disabled:hover:border-gray-200"
                >
                  <div className="w-14 h-14 rounded-2xl bg-gray-50 dark:bg-white/[0.04] flex items-center justify-center">
                    <Upload className="w-6 h-6" />
                  </div>
                  <div className="text-center">
                    <p className="text-[13px] font-medium">{assetSource.trim() ? "Click to select file" : "Select asset source first"}</p>
                    <p className="text-[11px] text-gray-300 dark:text-gray-600 mt-0.5">Images & videos — uploaded to Google Drive</p>
                  </div>
                </button>
              )}
            </div>
          )}

          {/* Library Tab */}
          {tab === "library" && (
            <div className="p-4 space-y-3">
              {/* Search + filter */}
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-300 dark:text-gray-600" />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search media..."
                    className="w-full h-9 pl-9 pr-3 rounded-lg bg-gray-50 dark:bg-white/[0.03] border border-gray-100 dark:border-white/[0.06] text-[12px] text-gray-700 dark:text-gray-300 placeholder:text-gray-400 outline-none focus:border-orange-300 transition-all"
                  />
                </div>
                <button
                  onClick={() => setUnusedOnly(!unusedOnly)}
                  className={`h-9 px-3 rounded-lg text-[11px] font-medium border transition-all cursor-pointer ${
                    unusedOnly
                      ? "bg-emerald-50 border-emerald-200 text-emerald-700 dark:bg-emerald-500/10 dark:border-emerald-500/20 dark:text-emerald-400"
                      : "bg-white border-gray-200 text-gray-500 dark:bg-transparent dark:border-white/[0.08] dark:text-gray-400"
                  }`}
                >
                  {unusedOnly ? "Unused Only" : "All Assets"}
                </button>
              </div>

              {/* Grid */}
              {filteredMedia.length > 0 ? (
                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2">
                  {filteredMedia.map((asset, i) => (
                    <button
                      key={i}
                      onClick={() => {
                        onSelect({ url: asset.url, name: asset.name, mimeType: asset.type === "video" ? "video/mp4" : "image/jpeg" });
                        onClose();
                      }}
                      className="group relative aspect-square rounded-xl overflow-hidden border-2 border-transparent hover:border-orange-400 transition-all cursor-pointer bg-gray-50 dark:bg-white/[0.03]"
                    >
                      {asset.type === "image" ? (
                        <img src={asset.url} alt={asset.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200" />
                      ) : (
                        <div className="w-full h-full flex flex-col items-center justify-center">
                          <Film className="w-6 h-6 text-gray-400" />
                          <p className="text-[8px] text-gray-400 mt-1 truncate max-w-full px-1">{asset.name}</p>
                        </div>
                      )}
                      {/* Usage badge */}
                      <div className="absolute top-1.5 left-1.5">
                        {asset.usedIn && asset.usedIn.length > 0 ? (
                          <span className="text-[7px] px-1.5 py-0.5 rounded-full bg-emerald-500/90 text-white font-bold flex items-center gap-0.5"><CheckCircle className="w-2 h-2" />Used</span>
                        ) : (
                          <span className="text-[7px] px-1.5 py-0.5 rounded-full bg-gray-500/70 text-white font-bold flex items-center gap-0.5"><Clock className="w-2 h-2" />Free</span>
                        )}
                      </div>
                      {/* Name overlay */}
                      <div className="absolute bottom-0 left-0 right-0 bg-black/60 backdrop-blur-sm px-1.5 py-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <p className="text-[8px] text-white truncate">{asset.name}</p>
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="text-center py-12">
                  <ImageIcon className="w-8 h-8 text-gray-300 dark:text-gray-600 mx-auto mb-2" />
                  <p className="text-[13px] text-gray-400">No matching assets</p>
                  <p className="text-[11px] text-gray-300 dark:text-gray-600 mt-1">{unusedOnly ? "Try showing all assets" : "Upload some media first"}</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
