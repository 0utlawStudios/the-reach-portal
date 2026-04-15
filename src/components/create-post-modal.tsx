"use client";

import { RawImage } from "@/components/raw-image";
import { useState, useRef } from "react";
import { usePipeline } from "@/lib/pipeline-context";
import { Platform, ContentType, ALL_PLATFORMS, DEFAULT_CHECKLIST } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { X, Image as ImageIcon, Film, Layers, PlayCircle, Upload, FileVideo, Plus, CheckSquare, FileText, Link2, MessageSquare } from "lucide-react";
import { PlatformIcon } from "./platform-icons";
import { useToast } from "@/lib/toast-context";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/lib/supabaseClient";
import { MentionTextarea } from "./mention-textarea";

const contentTypes: { id: ContentType; label: string; icon: React.ReactNode }[] = [
  { id: "image", label: "Image", icon: <ImageIcon className="w-3.5 h-3.5" /> },
  { id: "video", label: "Video", icon: <Film className="w-3.5 h-3.5" /> },
  { id: "reel", label: "Reel", icon: <PlayCircle className="w-3.5 h-3.5" /> },
  { id: "carousel", label: "Carousel", icon: <Layers className="w-3.5 h-3.5" /> },
  { id: "story", label: "Story", icon: <Film className="w-3.5 h-3.5" /> },
];

const ASSET_SOURCES = ["Envato Elements", "Pexels", "Shot by Team", "Client Provided", "Google Images", "AI Generated"];

interface UploadedFile {
  id: string;
  name: string;
  size: string;
  type: "image" | "video";
  preview: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
}

type ModalTab = "content" | "checklist" | "details";

export function CreatePostModal({ open, onClose }: Props) {
  const { createCard } = usePipeline();
  const { addToast } = useToast();
  const { currentUser } = useAuth();
  const [title, setTitle] = useState("");
  const [caption, setCaption] = useState("");
  const [hook, setHook] = useState("");
  const [platforms, setPlatforms] = useState<Platform[]>([]);
  const [contentType, setContentType] = useState<ContentType>("video");
  const [scheduledDate, setScheduledDate] = useState("");
  const [scheduledTime, setScheduledTime] = useState("");
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [assetSource, setAssetSource] = useState("");
  const [assetSourceOther, setAssetSourceOther] = useState(false);
  const [designLink, setDesignLink] = useState("");
  const [driveFolder, setDriveFolder] = useState("");
  const [notes, setNotes] = useState("");
  const [licenseFileId, setLicenseFileId] = useState("");
  const [activeTab, setActiveTab] = useState<ModalTab>("content");
  const [checklist, setChecklist] = useState(() => DEFAULT_CHECKLIST.map((c) => ({ ...c })));
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadingFileName, setUploadingFileName] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const rawFilesRef = useRef<Map<string, File>>(new Map());

  if (!open) return null;

  const togglePlatform = (p: Platform) => {
    setPlatforms((prev) => prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]);
  };

  const toggleChecklist = (id: string) => {
    setChecklist((prev) => prev.map((c) => c.id === id ? { ...c, checked: !c.checked } : c));
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files;
    if (!selected) return;
    const newFiles: UploadedFile[] = Array.from(selected).map((file) => {
      const id = Date.now().toString() + Math.random().toString(36).slice(2);
      rawFilesRef.current.set(id, file);
      return {
        id,
        name: file.name,
        size: file.size < 1024 * 1024 ? `${(file.size / 1024).toFixed(0)} KB` : `${(file.size / (1024 * 1024)).toFixed(1)} MB`,
        type: file.type.startsWith("video") ? "video" : "image",
        preview: URL.createObjectURL(file),
      };
    });
    setFiles((prev) => [...prev, ...newFiles]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removeFile = (id: string) => {
    rawFilesRef.current.delete(id);
    setFiles((prev) => {
      const file = prev.find((f) => f.id === id);
      if (file) URL.revokeObjectURL(file.preview);
      return prev.filter((f) => f.id !== id);
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const missing: string[] = [];
    if (!title.trim()) missing.push("title");
    if (files.length === 0) missing.push("content file");
    if (platforms.length === 0) missing.push("platform");
    if (!scheduledDate) missing.push("date");
    if (!scheduledTime) missing.push("time");
    if (!hook.trim()) missing.push("hook");
    if (!caption.trim()) missing.push("caption");
    if (!assetSource.trim()) missing.push("asset source");
    if (missing.length > 0) { addToast(`Missing required fields: ${missing.join(", ")}`, "error"); return; }

    setSubmitting(true);

    let thumbnailUrl = "";
    const rawFiles: import("@/lib/types").RawFile[] = [];
    let uploadFailed = false;

    // Upload all files to Drive — NO BLOB FALLBACK
    if (files.length > 0) {
      const { uploadToDrive } = await import("@/lib/drive-upload");
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        const rawFile = rawFilesRef.current.get(f.id);
        if (!rawFile) continue;
        setUploadingFileName(rawFile.name);
        setUploadProgress(0);
        try {
          const result = await uploadToDrive(rawFile, "raw-files", undefined, setUploadProgress);
          rawFiles.push({
            name: rawFile.name,
            url: result.url,
            fileId: result.fileId,
            usageType: i === 0 ? "master" : "supplementary",
            mimeType: result.mimeType || rawFile.type,
            size: result.size || rawFile.size,
            uploadedAt: new Date().toISOString(),
          });
          if (i === 0) thumbnailUrl = result.url;
        } catch (err) {
          addToast(`Failed to upload ${rawFile.name}: ${err instanceof Error ? err.message : "error"}`, "error");
          uploadFailed = true;
          break;
        }
      }
    }

    if (uploadFailed) {
      setSubmitting(false);
      return; // Don't create card with missing files
    }

    createCard({
      title: title.trim(),
      stage: "ideas",
      platforms,
      contentType,
      thumbnailUrl,
      caption: caption.trim() || undefined,
      hook: hook.trim() || undefined,
      scheduledDate: scheduledDate || undefined,
      scheduledTime: scheduledTime || undefined,
      createdBy: currentUser.name,
      assetSource: assetSource || undefined,
      checklist,
      licenseFileId: licenseFileId || undefined,
      notes: notes.trim() ? `${currentUser.name} (${new Date().toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}): ${notes.trim()}` : undefined,
      sourceVault: (designLink || driveFolder || rawFiles.length > 0) ? {
        designLink: designLink || undefined,
        driveFolder: driveFolder || undefined,
        rawFiles: rawFiles.length > 0 ? rawFiles : undefined,
      } : undefined,
    });

    // Insert uploaded files into media_assets so they appear in Media Library
    for (const rf of rawFiles) {
      supabase.from("media_assets").insert({
        name: rf.name,
        url: rf.url,
        file_type: rf.mimeType?.startsWith("video") ? "video" : "image",
        folder: "Pipeline Uploads",
        added_by: currentUser.name,
      }).then(() => {});
    }

    rawFilesRef.current.clear();
    setTitle(""); setCaption(""); setHook(""); setPlatforms([]); setContentType("video");
    setScheduledDate(""); setScheduledTime(""); setFiles([]); setAssetSource(""); setAssetSourceOther(false); setLicenseFileId("");
    setDesignLink(""); setDriveFolder(""); setNotes(""); setActiveTab("content");
    setChecklist(DEFAULT_CHECKLIST.map((c) => ({ ...c })));
    setSubmitting(false);
    onClose();
  };

  const inputClass = "w-full h-9 px-3 rounded-lg bg-gray-50 dark:bg-white/[0.04] border border-gray-200 dark:border-white/[0.08] text-[12px] text-gray-800 dark:text-gray-200 placeholder:text-gray-400 dark:placeholder:text-gray-600 outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100 dark:focus:ring-orange-500/10 transition-all";

  const tabs: { id: ModalTab; label: string; icon: React.ReactNode }[] = [
    { id: "content", label: "Content", icon: <FileText className="w-3 h-3" /> },
    { id: "checklist", label: "Checklist", icon: <CheckSquare className="w-3 h-3" /> },
    { id: "details", label: "Details", icon: <Link2 className="w-3 h-3" /> },
  ];

  const checkedCount = checklist.filter((c) => c.checked).length;

  return (
    <>
      <div onClick={onClose} className="fixed inset-0 bg-black/30 dark:bg-black/60 z-50" />
      <div className="fixed inset-0 flex items-center justify-center z-50 p-4">
        <div className="bg-white dark:bg-[#151518] rounded-2xl border border-gray-200 dark:border-white/[0.08] shadow-2xl w-full max-w-[580px] max-h-[90vh] flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-white/[0.06] shrink-0">
            <h2 className="text-[15px] font-semibold text-gray-900 dark:text-white">Create New Post</h2>
            <button onClick={onClose} className="p-1.5 rounded-md hover:bg-gray-100 dark:hover:bg-white/[0.06] text-gray-400 cursor-pointer"><X className="w-4 h-4" /></button>
          </div>

          {/* Tab bar */}
          <div className="flex items-center gap-0.5 px-5 border-b border-gray-100 dark:border-white/[0.06] shrink-0">
            {tabs.map((tab) => (
              <button key={tab.id} type="button" onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-1.5 px-3.5 py-2.5 text-[11px] font-medium border-b-2 -mb-px transition-colors cursor-pointer ${
                  activeTab === tab.id ? "border-orange-500 text-orange-600 dark:text-orange-400" : "border-transparent text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                }`}>
                {tab.icon}{tab.label}
                {tab.id === "checklist" && <span className="text-[9px] bg-gray-100 dark:bg-white/[0.06] text-gray-500 dark:text-gray-400 px-1.5 rounded-full">{checkedCount}/{checklist.length}</span>}
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-5 space-y-4">

            {/* ── Content Tab ── */}
            {activeTab === "content" && (
              <>
                {/* Title */}
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-[0.08em]">Title <span className="text-red-400">*</span></label>
                  <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Product Launch Reel, BTS Shoot Day" className={inputClass} autoFocus />
                </div>

                {/* Content for Publishing */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-[0.08em]">Content for Publishing</label>
                    <span className="text-[8px] text-emerald-500 font-medium bg-emerald-50 dark:bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-200 dark:border-emerald-500/20">Pulled by n8n</span>
                  </div>
                  <input ref={fileInputRef} type="file" multiple accept="image/*,video/*" onChange={handleFileSelect} className="hidden" />

                  {files.length > 0 && (
                    <div className="grid grid-cols-3 gap-2 mb-2">
                      {files.map((file) => (
                        <div key={file.id} className="relative group rounded-lg overflow-hidden border border-gray-200 dark:border-white/[0.08] bg-gray-50 dark:bg-white/[0.03]">
                          {file.type === "image" ? (
                            <RawImage src={file.preview} alt={file.name} className="w-full aspect-square object-cover" />
                          ) : (
                            <div className="w-full aspect-square flex flex-col items-center justify-center bg-gray-100 dark:bg-white/[0.04]">
                              <FileVideo className="w-6 h-6 text-gray-400 dark:text-gray-500" />
                              <p className="text-[8px] text-gray-400 dark:text-gray-500 mt-1 truncate max-w-full px-1">{file.name}</p>
                            </div>
                          )}
                          <div className="absolute bottom-0 left-0 right-0 bg-black/60 backdrop-blur-sm px-1.5 py-1">
                            <p className="text-[8px] text-white truncate">{file.name}</p>
                            <p className="text-[7px] text-white/60">{file.size}</p>
                          </div>
                          <button type="button" onClick={() => removeFile(file.id)} className="absolute top-1 right-1 w-5 h-5 rounded-full bg-red-500 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer">
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      ))}
                      <button type="button" onClick={() => fileInputRef.current?.click()} className="w-full aspect-square rounded-lg border-2 border-dashed border-gray-200 dark:border-white/[0.1] flex flex-col items-center justify-center text-gray-400 dark:text-gray-500 hover:text-orange-500 hover:border-orange-300 dark:hover:border-orange-500/30 transition-colors cursor-pointer">
                        <Plus className="w-5 h-5" />
                        <span className="text-[9px] mt-1">Add more</span>
                      </button>
                    </div>
                  )}

                  {files.length === 0 && (
                    <button type="button" onClick={() => fileInputRef.current?.click()} className="w-full p-6 rounded-xl border-2 border-dashed border-gray-200 dark:border-white/[0.1] flex flex-col items-center justify-center text-gray-400 dark:text-gray-500 hover:text-orange-500 hover:border-orange-300 dark:hover:border-orange-500/30 transition-colors cursor-pointer group">
                      <div className="w-10 h-10 rounded-xl bg-gray-50 dark:bg-white/[0.04] flex items-center justify-center mb-2 group-hover:bg-orange-50 dark:group-hover:bg-orange-500/10 transition-colors">
                        <Upload className="w-5 h-5" />
                      </div>
                      <p className="text-[12px] font-medium text-gray-600 dark:text-gray-400">Upload the actual content to publish</p>
                      <p className="text-[10px] text-gray-300 dark:text-gray-600 mt-0.5">First file becomes the card thumbnail</p>
                    </button>
                  )}
                </div>

                {/* Platforms */}
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-[0.08em]">Platforms <span className="text-red-400">*</span></label>
                  <div className="flex flex-wrap gap-1.5">
                    {ALL_PLATFORMS.map((p) => (
                      <button key={p.id} type="button" onClick={() => togglePlatform(p.id)}
                        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium border transition-colors cursor-pointer ${
                          platforms.includes(p.id)
                            ? "bg-orange-50 border-orange-200 text-orange-700 dark:bg-orange-500/10 dark:border-orange-500/30 dark:text-orange-400"
                            : "bg-white border-gray-200 text-gray-500 hover:bg-gray-50 dark:bg-transparent dark:border-white/[0.08] dark:text-gray-400"
                        }`}>
                        <PlatformIcon platform={p.id} className="w-3.5 h-3.5" />{p.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Content type */}
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-[0.08em]">Content Type</label>
                  <div className="flex flex-wrap gap-1.5">
                    {contentTypes.map((ct) => (
                      <button key={ct.id} type="button" onClick={() => setContentType(ct.id)}
                        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium border transition-colors cursor-pointer ${
                          contentType === ct.id
                            ? "bg-gray-900 border-gray-900 text-white dark:bg-white dark:border-white dark:text-gray-900"
                            : "bg-white border-gray-200 text-gray-500 hover:bg-gray-50 dark:bg-transparent dark:border-white/[0.08] dark:text-gray-400"
                        }`}>
                        {ct.icon}{ct.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Hook */}
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-[0.08em]">Hook (First 3 Seconds) <span className="text-red-400">*</span></label>
                  <input value={hook} onChange={(e) => setHook(e.target.value)} placeholder="What grabs attention?" className={inputClass} />
                </div>

                {/* Caption */}
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-[0.08em]">Caption <span className="text-red-400">*</span></label>
                  <MentionTextarea value={caption} onChange={setCaption} placeholder="Write your caption... Type @ to mention team members" className="min-h-[70px] w-full bg-gray-50 dark:bg-white/[0.04] border border-gray-200 dark:border-white/[0.08] rounded-lg text-[12px] text-gray-800 dark:text-gray-200 placeholder:text-gray-400 dark:placeholder:text-gray-600 resize-none p-3 outline-none focus:ring-2 focus:ring-orange-100 dark:focus:ring-orange-500/10 focus:border-orange-400 transition-all" rows={3} />
                </div>

                {/* Schedule */}
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-[0.08em]">Schedule Date & Time <span className="text-red-400">*</span></label>
                  <div className="flex gap-2">
                    <input type="date" value={scheduledDate} onChange={(e) => setScheduledDate(e.target.value)} className={`${inputClass} flex-[3]`} required />
                    <input type="time" value={scheduledTime} onChange={(e) => setScheduledTime(e.target.value)} className={`${inputClass} flex-[2]`} required />
                  </div>
                </div>

                {/* Asset Source */}
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-[0.08em]">Asset Source <span className="text-red-400">*</span></label>
                  <select
                    value={assetSourceOther ? "__other__" : assetSource}
                    onChange={(e) => {
                      if (e.target.value === "__other__") {
                        setAssetSourceOther(true);
                        setAssetSource("");
                      } else {
                        setAssetSourceOther(false);
                        setAssetSource(e.target.value);
                      }
                    }}
                    className={`${inputClass} cursor-pointer`}
                  >
                    <option value="">Select source...</option>
                    {ASSET_SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
                    <option value="__other__">Other (specify below)</option>
                  </select>
                  {assetSourceOther && (
                    <input
                      value={assetSource}
                      onChange={(e) => setAssetSource(e.target.value)}
                      placeholder="Specify the asset source..."
                      className={`${inputClass} border-orange-200 dark:border-orange-500/20`}
                      autoFocus
                    />
                  )}
                </div>

                {/* License upload */}
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-[0.08em]">License / Release <span className="text-gray-300 dark:text-gray-600 text-[8px] normal-case">Optional</span></label>
                  {licenseFileId ? (
                    <div className="flex items-center gap-2 bg-emerald-50 dark:bg-emerald-500/5 border border-emerald-200 dark:border-emerald-500/20 rounded-lg px-3 py-2">
                      <span className="text-[11px] text-emerald-700 dark:text-emerald-400 font-medium flex-1">License uploaded</span>
                      <button type="button" onClick={() => setLicenseFileId("")} className="text-[10px] text-gray-400 hover:text-red-500 cursor-pointer">Remove</button>
                    </div>
                  ) : (
                    <button type="button" onClick={async () => {
                      const input = document.createElement("input");
                      input.type = "file";
                      input.accept = "image/*,.pdf,.txt";
                      input.onchange = async (ev) => {
                        const file = (ev.target as HTMLInputElement).files?.[0];
                        if (!file) return;
                        addToast("Uploading license...", "info");
                        try {
                          const { uploadToDrive } = await import("@/lib/drive-upload");
                          const result = await uploadToDrive(file, "raw-files");
                          setLicenseFileId(result.fileId);
                          addToast("License uploaded", "success");
                        } catch { addToast("License upload failed", "error"); }
                      };
                      input.click();
                    }} className="w-full border border-dashed border-gray-200 dark:border-white/[0.08] rounded-lg py-2.5 flex items-center justify-center gap-2 text-gray-400 dark:text-gray-500 hover:text-orange-500 hover:border-orange-300 dark:hover:border-orange-500/30 transition-all cursor-pointer text-[11px]">
                      <Upload className="w-3.5 h-3.5" />Upload license (PDF or screenshot)
                    </button>
                  )}
                </div>

                {/* Notes */}
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-[0.08em] flex items-center gap-1.5"><MessageSquare className="w-3 h-3 text-orange-400" />Notes</label>
                  <MentionTextarea value={notes} onChange={setNotes} placeholder="Any notes for the team... Type @ to mention" className={`${inputClass} h-auto min-h-[60px] resize-none py-2`} rows={2} />
                </div>
              </>
            )}

            {/* ── Checklist Tab ── */}
            {activeTab === "checklist" && (
              <div className="space-y-2">
                <p className="text-[11px] text-gray-400 dark:text-gray-500">Complete before submitting for approval.</p>
                {checklist.map((item) => (
                  <button key={item.id} type="button" onClick={() => toggleChecklist(item.id)}
                    className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-lg border transition-colors cursor-pointer text-left ${
                      item.checked
                        ? "bg-emerald-50 dark:bg-emerald-500/5 border-emerald-200 dark:border-emerald-500/20"
                        : "bg-white dark:bg-white/[0.02] border-gray-200 dark:border-white/[0.06] hover:bg-gray-50 dark:hover:bg-white/[0.03]"
                    }`}>
                    <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 transition-colors ${
                      item.checked ? "bg-emerald-500 border-emerald-500" : "border-gray-300 dark:border-gray-600"
                    }`}>
                      {item.checked && <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>}
                    </div>
                    <span className={`text-[12px] font-medium ${item.checked ? "text-emerald-700 dark:text-emerald-400 line-through" : "text-gray-700 dark:text-gray-300"}`}>{item.label}</span>
                  </button>
                ))}
              </div>
            )}

            {/* ── Details Tab (Source Vault + Links) ── */}
            {activeTab === "details" && (
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-[0.08em]">Design File Link</label>
                  <input value={designLink} onChange={(e) => setDesignLink(e.target.value)} placeholder="e.g. Figma, Canva, or Adobe link" className={`${inputClass} font-mono text-[11px]`} />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-[0.08em]">Google Drive Folder</label>
                  <input value={driveFolder} onChange={(e) => setDriveFolder(e.target.value)} placeholder="e.g. drive.google.com/drive/folders/..." className={`${inputClass} font-mono text-[11px]`} />
                </div>
              </div>
            )}

            {/* Upload progress */}
            {submitting && uploadingFileName && (
              <div className="bg-white dark:bg-white/[0.03] rounded-xl border border-gray-200/60 dark:border-white/[0.06] p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-medium text-gray-600 dark:text-gray-300 truncate flex-1">{uploadingFileName}</span>
                  <span className="text-[10px] font-bold text-orange-500 tabular-nums ml-2">{uploadProgress}%</span>
                </div>
                <div className="w-full h-1.5 rounded-full bg-gray-100 dark:bg-white/[0.06] overflow-hidden">
                  <div className="h-full rounded-full bg-gradient-to-r from-orange-500 to-amber-500 transition-all duration-300" style={{ width: `${uploadProgress}%` }} />
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-2 pt-2">
              <Button type="button" variant="outline" onClick={onClose} disabled={submitting} className="flex-1 h-10 rounded-lg text-[12px]">Cancel</Button>
              <Button type="submit" disabled={submitting || !title.trim() || files.length === 0 || platforms.length === 0 || !scheduledDate || !scheduledTime || !hook.trim() || !caption.trim() || !assetSource.trim()} className="flex-1 h-10 rounded-lg bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 text-white text-[12px] disabled:opacity-40 shadow-sm">
                {submitting ? "Uploading..." : "Create Post"}
              </Button>
            </div>
          </form>
        </div>
      </div>
    </>
  );
}
