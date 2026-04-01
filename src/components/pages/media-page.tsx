"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import { MediaAsset } from "@/lib/types";
import { usePipeline } from "@/lib/pipeline-context";
import { useAuth } from "@/lib/auth-context";
import { useToast } from "@/lib/toast-context";
import { supabase } from "@/lib/supabaseClient";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  FolderOpen, Upload, Film, Image as ImageIcon, Search, Grid3X3, List,
  CheckCircle, Clock, X, Trash2, Eye, Link2, ExternalLink, Download,
} from "lucide-react";

type StatusFilter = "all" | "unused" | "inuse";

function isSupabaseConfigured(): boolean {
  return !!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

function dbToAsset(row: any): MediaAsset {
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    type: row.file_type,
    folder: row.folder || "Uploads",
    uploadedAt: row.uploaded_at?.split("T")[0] || new Date().toISOString().split("T")[0],
    addedBy: row.added_by || undefined,
    usedIn: row.used_in || undefined,
  };
}

export function MediaPage() {
  const { cards } = usePipeline();
  const { currentUser } = useAuth();
  const { addToast } = useToast();
  const [media, setMedia] = useState<MediaAsset[]>([]);
  const [activeFolder, setActiveFolder] = useState<string>("all");
  const [activeType, setActiveType] = useState<"all" | "image" | "video">("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [viewMode, setViewMode] = useState<"grid" | "list">("list");
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [lightboxAsset, setLightboxAsset] = useState<MediaAsset | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadingFileName, setUploadingFileName] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const useDb = isSupabaseConfigured();

  // ─── Load media from Supabase ───
  useEffect(() => {
    if (!useDb) return;
    supabase
      .from("media_assets")
      .select("*")
      .order("uploaded_at", { ascending: false })
      .then(({ data }) => {
        if (data && data.length > 0) setMedia(data.map(dbToAsset));
      });
  }, [useDb]);

  const folders = useMemo(() => Array.from(new Set(media.map((m) => m.folder))).sort(), [media]);

  const filteredMedia = useMemo(() => {
    let items = [...media];
    if (activeFolder !== "all") items = items.filter((m) => m.folder === activeFolder);
    if (activeType !== "all") items = items.filter((m) => m.type === activeType);
    if (statusFilter === "unused") items = items.filter((m) => !m.usedIn || m.usedIn.length === 0);
    if (statusFilter === "inuse") items = items.filter((m) => m.usedIn && m.usedIn.length > 0);
    if (search) items = items.filter((m) => m.name.toLowerCase().includes(search.toLowerCase()));
    return items.sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
  }, [media, activeFolder, activeType, statusFilter, search]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || uploading) return;
    setUploading(true);
    const { uploadToDrive } = await import("@/lib/drive-upload");
    for (const file of Array.from(files)) {
      setUploadingFileName(file.name);
      setUploadProgress(0);
      try {
        const result = await uploadToDrive(file, "media-library", undefined, setUploadProgress);
        const asset: MediaAsset = {
          id: `m-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          name: file.name,
          url: result.url,
          type: file.type.startsWith("video") ? "video" : "image",
          folder: "Uploads",
          uploadedAt: new Date().toISOString().split("T")[0],
          addedBy: currentUser.name,
        };

        // Persist to Supabase
        if (useDb) {
          const { data: inserted } = await supabase
            .from("media_assets")
            .insert({
              name: asset.name,
              url: asset.url,
              file_type: asset.type,
              folder: asset.folder,
              added_by: asset.addedBy,
            })
            .select("id")
            .single();
          if (inserted) asset.id = inserted.id;
        }

        setMedia((prev) => [asset, ...prev]);
        addToast(`${file.name} uploaded`, "success");
      } catch (err) {
        addToast(`Failed to upload ${file.name}: ${err instanceof Error ? err.message : "error"}`, "error");
      }
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
    setUploading(false);
    setUploadProgress(0);
    setUploadingFileName("");
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  };

  const deleteSelected = () => {
    const idsToDelete = Array.from(selectedIds);
    setMedia((prev) => prev.filter((m) => !selectedIds.has(m.id)));
    setSelectedIds(new Set());
    // Delete from Supabase
    if (useDb && idsToDelete.length > 0) {
      supabase.from("media_assets").delete().in("id", idsToDelete).then(() => {});
    }
  };

  const getUsageInfo = (asset: MediaAsset) => (!asset.usedIn || asset.usedIn.length === 0) ? null : asset.usedIn.map((id) => cards.find((c) => c.id === id)).filter(Boolean);

  const copyShareLink = (asset: MediaAsset) => {
    const siteUrl = typeof window !== "undefined" ? window.location.origin : "";
    const shareUrl = asset.url.startsWith("/") ? `${siteUrl}${asset.url}` : asset.url;
    navigator.clipboard.writeText(shareUrl).then(() => addToast(`Link copied for "${asset.name}"`, "success"));
  };

  const openInNewTab = (asset: MediaAsset) => {
    const siteUrl = typeof window !== "undefined" ? window.location.origin : "";
    const url = asset.url.startsWith("/") ? `${siteUrl}${asset.url}` : asset.url;
    window.open(url, "_blank");
  };

  const formatDate = (date: string, time?: string) => {
    const d = new Date(date + "T12:00:00");
    const formatted = d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    return time ? `${formatted} · ${time}` : formatted;
  };

  return (
    <div className="flex h-full flex-col md:flex-row">
      {/* Sidebar */}
      <div className="w-full md:w-[200px] border-b md:border-b-0 md:border-r border-gray-100 dark:border-white/[0.06] bg-white dark:bg-[#111] p-3 flex md:flex-col shrink-0 overflow-x-auto md:overflow-x-visible gap-1 md:gap-0">
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
        <input ref={fileInputRef} type="file" multiple accept="image/*,video/*" onChange={handleUpload} className="hidden" />
        <button disabled={uploading} onClick={() => fileInputRef.current?.click()} className="hidden md:flex mt-2 w-full items-center justify-center gap-2 h-9 rounded-lg bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 text-white text-[11px] font-medium cursor-pointer shadow-sm transition-all duration-200 disabled:opacity-40">
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

          {/* View toggle */}
          <div className="hidden sm:flex items-center gap-0.5 border-l border-gray-200 dark:border-white/[0.06] pl-2">
            <button onClick={() => setViewMode("grid")} className={`p-1.5 rounded-md cursor-pointer transition-all duration-200 ${viewMode === "grid" ? "bg-gray-100 dark:bg-white/[0.08] text-gray-700 dark:text-white" : "text-gray-400"}`}><Grid3X3 className="w-3.5 h-3.5" /></button>
            <button onClick={() => setViewMode("list")} className={`p-1.5 rounded-md cursor-pointer transition-all duration-200 ${viewMode === "list" ? "bg-gray-100 dark:bg-white/[0.08] text-gray-700 dark:text-white" : "text-gray-400"}`}><List className="w-3.5 h-3.5" /></button>
          </div>

          {selectedIds.size > 0 && (
            <div className="flex items-center gap-2 border-l border-gray-200 dark:border-white/[0.06] pl-2">
              <span className="text-[10px] text-gray-500">{selectedIds.size} selected</span>
              <button onClick={deleteSelected} className="text-[10px] text-red-500 cursor-pointer font-medium flex items-center gap-1"><Trash2 className="w-3 h-3" />Delete</button>
              <button onClick={() => setSelectedIds(new Set())} className="text-gray-400 cursor-pointer"><X className="w-3.5 h-3.5" /></button>
            </div>
          )}

          <span className="ml-auto text-[10px] text-gray-400 hidden sm:block">{filteredMedia.length} files</span>
          {/* Mobile upload */}
          <button disabled={uploading} onClick={() => fileInputRef.current?.click()} className="md:hidden p-2 rounded-lg bg-orange-500 text-white cursor-pointer disabled:opacity-40"><Upload className="w-4 h-4" /></button>
        </div>

        {/* Upload progress */}
        {uploading && (
          <div className="px-4 py-3 border-b border-gray-100 dark:border-white/[0.06] bg-white dark:bg-[#111] shrink-0">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[11px] font-medium text-gray-600 dark:text-gray-300 truncate">{uploadingFileName}</span>
              <span className="text-[11px] font-bold text-orange-500 tabular-nums ml-2">{uploadProgress}%</span>
            </div>
            <div className="w-full h-1.5 rounded-full bg-gray-100 dark:bg-white/[0.06] overflow-hidden">
              <div className="h-full rounded-full bg-gradient-to-r from-orange-500 to-amber-500 transition-all duration-300" style={{ width: `${uploadProgress}%` }} />
            </div>
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
                          <img src={asset.url} alt={asset.name} className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105" />
                        ) : (
                          <div className="w-full h-full flex flex-col items-center justify-center bg-gray-100 dark:bg-white/[0.04]"><Film className="w-8 h-8 text-gray-300 dark:text-gray-600" /></div>
                        )}
                        <div className="absolute top-2 right-2 px-1.5 py-0.5 rounded-md bg-black/50 backdrop-blur-sm text-[8px] text-white font-medium uppercase">{asset.type}</div>
                        {usage && usage.length > 0 ? (
                          <div className="absolute top-2 left-2 px-1.5 py-0.5 rounded-md bg-emerald-500/90 text-[8px] text-white font-medium flex items-center gap-0.5"><CheckCircle className="w-2.5 h-2.5" />In use</div>
                        ) : (
                          <div className="absolute top-2 left-2 px-1.5 py-0.5 rounded-md bg-gray-500/70 text-[8px] text-white font-medium flex items-center gap-0.5"><Clock className="w-2.5 h-2.5" />Unused</div>
                        )}
                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-all duration-200 flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100">
                          <button onClick={(e) => { e.stopPropagation(); copyShareLink(asset); }} className="w-8 h-8 rounded-full bg-white/90 flex items-center justify-center shadow-lg hover:bg-white transition-colors" title="Copy link"><Link2 className="w-3.5 h-3.5 text-gray-700" /></button>
                          <div className="w-8 h-8 rounded-full bg-white/90 flex items-center justify-center shadow-lg"><Eye className="w-3.5 h-3.5 text-gray-700" /></div>
                          <button onClick={(e) => { e.stopPropagation(); openInNewTab(asset); }} className="w-8 h-8 rounded-full bg-white/90 flex items-center justify-center shadow-lg hover:bg-white transition-colors" title="Open"><ExternalLink className="w-3.5 h-3.5 text-gray-700" /></button>
                        </div>
                      </div>
                      <button onClick={(e) => { e.stopPropagation(); toggleSelect(asset.id); }} className={`absolute top-2 right-2 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all duration-200 ${selected ? "bg-blue-500 border-blue-500" : "border-white/80 bg-black/20 opacity-0 group-hover:opacity-100"}`}>
                        {selected && <CheckCircle className="w-3 h-3 text-white" />}
                      </button>
                      <div className="p-2.5">
                        <p className="text-[11px] font-medium text-gray-700 dark:text-gray-300 truncate">{asset.name}</p>
                        <div className="flex items-center justify-between mt-1">
                          <span className="text-[9px] text-gray-400 flex items-center gap-1">
                            {asset.addedBy && <span className="w-4 h-4 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-[6px] font-bold text-white">{asset.addedBy[0]}</span>}
                            {asset.addedBy}
                          </span>
                          <span className="text-[9px] text-gray-400">{asset.uploadedAt.slice(5)}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="overflow-x-auto -mx-4 px-4">
                <div className="bg-white dark:bg-[#151518] rounded-xl border border-gray-100 dark:border-white/[0.06] overflow-hidden shadow-sm min-w-[700px]">
                  <div className="grid grid-cols-[1fr_80px_100px_90px_80px_140px] gap-2 px-4 py-2.5 border-b border-gray-100 dark:border-white/[0.06] text-[9px] font-bold text-gray-400 uppercase tracking-wider">
                    <div>File</div><div>Type</div><div>Folder</div><div>Status</div><div>Added By</div><div>Timestamp</div>
                  </div>
                  {filteredMedia.map((asset) => {
                    const usage = getUsageInfo(asset);
                    const selected = selectedIds.has(asset.id);
                    return (
                      <div key={asset.id}
                        className={`grid grid-cols-[1fr_80px_100px_90px_80px_140px] gap-2 px-4 py-2.5 border-b border-gray-50 dark:border-white/[0.03] last:border-0 hover:bg-slate-50 dark:hover:bg-white/[0.02] cursor-pointer transition-all duration-150 ${selected ? "bg-blue-50/50 dark:bg-blue-500/5" : ""}`}>
                        <div className="flex items-center gap-2.5" onClick={() => setLightboxAsset(asset)}>
                          <button onClick={(e) => { e.stopPropagation(); toggleSelect(asset.id); }}
                            className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-all duration-200 ${selected ? "bg-blue-500 border-blue-500" : "border-gray-300 dark:border-gray-600 hover:border-blue-400"}`}>
                            {selected && <CheckCircle className="w-3 h-3 text-white" />}
                          </button>
                          <div className="w-8 h-8 rounded-lg overflow-hidden bg-gray-100 dark:bg-white/[0.04] shrink-0">
                            {asset.type === "image" ? <img src={asset.url} alt="" className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center"><Film className="w-4 h-4 text-gray-400" /></div>}
                          </div>
                          <p className="text-[11px] font-medium text-gray-700 dark:text-gray-300 truncate">{asset.name}</p>
                        </div>
                        <div className="flex items-center">
                          <Badge variant="outline" className={`text-[9px] h-[18px] px-1.5 ${asset.type === "video" ? "text-purple-600 border-purple-200 bg-purple-50 dark:bg-purple-500/10 dark:text-purple-400 dark:border-purple-500/20" : "text-blue-600 border-blue-200 bg-blue-50 dark:bg-blue-500/10 dark:text-blue-400 dark:border-blue-500/20"}`}>
                            {asset.type === "video" ? <Film className="w-2.5 h-2.5 mr-0.5" /> : <ImageIcon className="w-2.5 h-2.5 mr-0.5" />}{asset.type}
                          </Badge>
                        </div>
                        <div className="flex items-center text-[10px] text-gray-500 dark:text-gray-400">{asset.folder}</div>
                        <div className="flex items-center">
                          {usage && usage.length > 0 ? (
                            <Badge variant="outline" className="text-[9px] h-[18px] px-1.5 text-emerald-600 border-emerald-200 bg-emerald-50 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/20"><CheckCircle className="w-2.5 h-2.5 mr-0.5" />In use</Badge>
                          ) : (
                            <Badge variant="outline" className="text-[9px] h-[18px] px-1.5 text-gray-500 border-gray-200 bg-gray-50 dark:bg-white/[0.04] dark:text-gray-400 dark:border-white/[0.08]"><Clock className="w-2.5 h-2.5 mr-0.5" />Unused</Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5">
                          {asset.addedBy && (
                            <>
                              <span className="w-5 h-5 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-[7px] font-bold text-white shrink-0">{asset.addedBy[0]}</span>
                              <span className="text-[10px] text-gray-600 dark:text-gray-400 font-medium truncate">{asset.addedBy}</span>
                            </>
                          )}
                        </div>
                        <div className="flex items-center text-[10px] text-gray-400 tabular-nums">{formatDate(asset.uploadedAt, asset.uploadedTime)}</div>
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
                  <p className="text-[10px] text-gray-400">{lightboxAsset.folder} · {formatDate(lightboxAsset.uploadedAt, lightboxAsset.uploadedTime)}{lightboxAsset.addedBy ? ` · by ${lightboxAsset.addedBy}` : ""}</p>
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={() => copyShareLink(lightboxAsset)} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-white/[0.06] text-gray-400 hover:text-orange-500 cursor-pointer transition-colors" title="Copy shareable link"><Link2 className="w-4 h-4" /></button>
                  <button onClick={() => openInNewTab(lightboxAsset)} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-white/[0.06] text-gray-400 hover:text-blue-500 cursor-pointer transition-colors" title="Open in new tab"><ExternalLink className="w-4 h-4" /></button>
                  <button onClick={() => setLightboxAsset(null)} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-white/[0.06] text-gray-400 cursor-pointer transition-colors"><X className="w-5 h-5" /></button>
                </div>
              </div>
              <div className="flex-1 overflow-hidden bg-gray-50 dark:bg-black flex items-center justify-center p-4">
                {lightboxAsset.type === "image" ? (
                  <img src={lightboxAsset.url} alt={lightboxAsset.name} className="max-w-full max-h-[60vh] object-contain rounded-lg" />
                ) : (
                  <div className="flex flex-col items-center justify-center text-gray-400 gap-2">
                    <Film className="w-16 h-16" />
                    <p className="text-[13px]">Video preview</p>
                    <p className="text-[11px] text-gray-500">{lightboxAsset.name}</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
