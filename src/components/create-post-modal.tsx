"use client";

import { useState, useRef } from "react";
import { usePipeline } from "@/lib/pipeline-context";
import { Platform, ContentType, ALL_PLATFORMS } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { X, Image as ImageIcon, Film, Layers, PlayCircle, Upload, FileVideo, Plus } from "lucide-react";
import { PlatformIcon } from "./platform-icons";
import { useToast } from "@/lib/toast-context";
import { MentionTextarea } from "./mention-textarea";

const contentTypes: { id: ContentType; label: string; icon: React.ReactNode }[] = [
  { id: "image", label: "Image", icon: <ImageIcon className="w-3.5 h-3.5" /> },
  { id: "video", label: "Video", icon: <Film className="w-3.5 h-3.5" /> },
  { id: "reel", label: "Reel", icon: <PlayCircle className="w-3.5 h-3.5" /> },
  { id: "carousel", label: "Carousel", icon: <Layers className="w-3.5 h-3.5" /> },
  { id: "story", label: "Story", icon: <Film className="w-3.5 h-3.5" /> },
];

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

export function CreatePostModal({ open, onClose }: Props) {
  const { createCard } = usePipeline();
  const { addToast } = useToast();
  const [title, setTitle] = useState("");
  const [caption, setCaption] = useState("");
  const [hook, setHook] = useState("");
  const [platforms, setPlatforms] = useState<Platform[]>([]);
  const [contentType, setContentType] = useState<ContentType>("video");
  const [scheduledDate, setScheduledDate] = useState("");
  const [scheduledTime, setScheduledTime] = useState("");
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const rawFilesRef = useRef<Map<string, File>>(new Map());

  if (!open) return null;

  const togglePlatform = (p: Platform) => {
    setPlatforms((prev) => prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]);
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
        size: file.size < 1024 * 1024
          ? `${(file.size / 1024).toFixed(0)} KB`
          : `${(file.size / (1024 * 1024)).toFixed(1)} MB`,
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
    if (platforms.length === 0) missing.push("platform");
    if (!scheduledDate) missing.push("date");
    if (!scheduledTime) missing.push("time");
    if (!hook.trim()) missing.push("hook");
    if (!caption.trim()) missing.push("caption");
    if (missing.length > 0) { addToast(`Missing required fields: ${missing.join(", ")}`, "error"); return; }

    setSubmitting(true);

    // Use blob preview initially, upload to Drive in background
    let thumbnailUrl = files.length > 0
      ? files[0].preview
      : "https://images.unsplash.com/photo-1497366216548-37526070297c?w=400&fit=crop";

    // Upload first file to Drive if available
    if (files.length > 0) {
      const rawFile = rawFilesRef.current.get(files[0].id);
      if (rawFile) {
        try {
          const { uploadToDrive } = await import("@/lib/drive-upload");
          const result = await uploadToDrive(rawFile, "thumbnails");
          thumbnailUrl = result.url;
        } catch {
          addToast("Drive upload failed — using local preview", "warning");
        }
      }
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
    });

    rawFilesRef.current.clear();
    setTitle(""); setCaption(""); setHook(""); setPlatforms([]); setContentType("video"); setScheduledDate(""); setScheduledTime(""); setFiles([]);
    setSubmitting(false);
    onClose();
  };

  return (
    <>
      <div onClick={onClose} className="fixed inset-0 bg-black/30 dark:bg-black/60 z-50" />
      <div className="fixed inset-0 flex items-center justify-center z-50 p-4">
        <div className="bg-white dark:bg-[#151518] rounded-2xl border border-gray-200 dark:border-white/[0.08] shadow-2xl w-full max-w-[560px] max-h-[90vh] flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-white/[0.06] shrink-0">
            <h2 className="text-[15px] font-semibold text-gray-900 dark:text-white">Create New Post</h2>
            <button onClick={onClose} className="p-1.5 rounded-md hover:bg-gray-100 dark:hover:bg-white/[0.06] text-gray-400 cursor-pointer"><X className="w-4 h-4" /></button>
          </div>

          <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-5 space-y-4">
            {/* Title */}
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-[0.08em]">Title <span className="text-red-400">*</span></label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Spring Cleaning Tips" className="h-10 bg-gray-50 dark:bg-white/[0.04] border-gray-200 dark:border-white/[0.08] rounded-lg text-[13px]" autoFocus />
            </div>

            {/* File Upload */}
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-[0.08em]">Media Files</label>
              <input ref={fileInputRef} type="file" multiple accept="image/*,video/*" onChange={handleFileSelect} className="hidden" />

              {files.length > 0 && (
                <div className="grid grid-cols-3 gap-2 mb-2">
                  {files.map((file) => (
                    <div key={file.id} className="relative group rounded-lg overflow-hidden border border-gray-200 dark:border-white/[0.08] bg-gray-50 dark:bg-white/[0.03]">
                      {file.type === "image" ? (
                        <img src={file.preview} alt={file.name} className="w-full aspect-square object-cover" />
                      ) : (
                        <div className="w-full aspect-square flex flex-col items-center justify-center bg-gray-100 dark:bg-white/[0.04]">
                          <FileVideo className="w-6 h-6 text-gray-400" />
                          <p className="text-[8px] text-gray-400 mt-1 truncate max-w-full px-1">{file.name}</p>
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
                  {/* Add more */}
                  <button type="button" onClick={() => fileInputRef.current?.click()} className="w-full aspect-square rounded-lg border-2 border-dashed border-gray-200 dark:border-white/[0.1] flex flex-col items-center justify-center text-gray-400 hover:text-blue-500 hover:border-blue-300 transition-colors cursor-pointer">
                    <Plus className="w-5 h-5" />
                    <span className="text-[9px] mt-1">Add more</span>
                  </button>
                </div>
              )}

              {files.length === 0 && (
                <button type="button" onClick={() => fileInputRef.current?.click()} className="w-full p-6 rounded-xl border-2 border-dashed border-gray-200 dark:border-white/[0.1] flex flex-col items-center justify-center text-gray-400 hover:text-blue-500 hover:border-blue-300 dark:hover:border-blue-500/30 transition-colors cursor-pointer group">
                  <div className="w-10 h-10 rounded-xl bg-gray-50 dark:bg-white/[0.04] flex items-center justify-center mb-2 group-hover:bg-blue-50 dark:group-hover:bg-blue-500/10 transition-colors">
                    <Upload className="w-5 h-5" />
                  </div>
                  <p className="text-[12px] font-medium">Upload images or videos</p>
                  <p className="text-[10px] text-gray-300 dark:text-gray-600 mt-0.5">Drag & drop or click to browse</p>
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
                        ? "bg-blue-50 border-blue-200 text-blue-700 dark:bg-blue-500/10 dark:border-blue-500/30 dark:text-blue-400"
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
              <Input value={hook} onChange={(e) => setHook(e.target.value)} placeholder="What grabs attention?" className="h-9 bg-gray-50 dark:bg-white/[0.04] border-gray-200 dark:border-white/[0.08] rounded-lg text-[12px]" />
            </div>

            {/* Caption */}
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-[0.08em]">Caption <span className="text-red-400">*</span></label>
              <MentionTextarea value={caption} onChange={setCaption} placeholder="Write your caption... Type @ to mention team members" className="min-h-[70px] w-full bg-gray-50 dark:bg-white/[0.04] border border-gray-200 dark:border-white/[0.08] rounded-lg text-[12px] resize-none p-3 outline-none focus:ring-2 focus:ring-blue-200 dark:focus:ring-blue-500/30" rows={3} />
            </div>

            {/* Schedule */}
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-[0.08em]">Schedule Date & Time <span className="text-red-400">*</span></label>
              <div className="flex gap-2">
                <Input type="date" value={scheduledDate} onChange={(e) => setScheduledDate(e.target.value)} className="h-9 flex-1 bg-gray-50 dark:bg-white/[0.04] border-gray-200 dark:border-white/[0.08] rounded-lg text-[12px]" required />
                <Input type="time" value={scheduledTime} onChange={(e) => setScheduledTime(e.target.value)} className="h-9 w-28 bg-gray-50 dark:bg-white/[0.04] border-gray-200 dark:border-white/[0.08] rounded-lg text-[12px]" required />
              </div>
              {(!scheduledDate || !scheduledTime) && <p className="text-[10px] text-amber-500">Required — this is when your post goes live</p>}
            </div>

            {/* Actions */}
            <div className="flex gap-2 pt-2">
              <Button type="button" variant="outline" onClick={onClose} className="flex-1 h-10 rounded-lg text-[12px]">Cancel</Button>
              <Button type="submit" disabled={submitting || !title.trim() || platforms.length === 0 || !scheduledDate || !scheduledTime || !hook.trim() || !caption.trim()} className="flex-1 h-10 rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white text-[12px] disabled:opacity-40 shadow-sm">
                {submitting ? "Uploading..." : "Create Post"}
              </Button>
            </div>
          </form>
        </div>
      </div>
    </>
  );
}
