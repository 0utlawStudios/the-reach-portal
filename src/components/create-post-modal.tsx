"use client";

import dynamic from "next/dynamic";
import { PreviewImage } from "@/components/preview-image";
import { useState, useRef, useEffect } from "react";
import { usePipeline } from "@/lib/pipeline-context";
import { Platform, ContentType, ALL_PLATFORMS, DEFAULT_CHECKLIST } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { X, Image as ImageIcon, Film, Layers, PlayCircle, Upload, FileVideo, Plus, CheckSquare, FileText, Link2, MessageSquare, FolderOpen } from "lucide-react";
import { PlatformIcon } from "./platform-icons";
import { useToast } from "@/lib/toast-context";
import { useAuth } from "@/lib/auth-context";
import { ensureMediaAsset } from "@/lib/media-assets";
import { isDrivePublishableMediaMime, normalizeDriveMimeType } from "@/lib/drive-policy";
import { getPublicDriveDownloadUrl } from "@/lib/drive-url-utils";
import { warmBrowserImagePreview } from "@/lib/image-preview";
import { driveFileIdFromUrl } from "@/lib/media-resolver";
import { MentionTextarea } from "./mention-textarea";
import { formatDateTimeCompact } from "@/lib/utils";
import type { MediaPickerSelection } from "./media-picker";
import { ValidationErrorModal } from "./validation-error-modal";
import { useFocusTrap } from "./use-focus-trap";
import {
  applyCreatePostUploadResults,
  getPendingCreatePostUploads,
  type CreatePostUploadFileState,
} from "@/lib/create-post-upload-state";

const MediaPicker = dynamic(() => import("./media-picker").then((mod) => mod.MediaPicker));

const contentTypes: { id: ContentType; label: string; icon: React.ReactNode }[] = [
  { id: "image", label: "Image", icon: <ImageIcon className="w-3.5 h-3.5" /> },
  { id: "video", label: "Video", icon: <Film className="w-3.5 h-3.5" /> },
  { id: "reel", label: "Reel", icon: <PlayCircle className="w-3.5 h-3.5" /> },
  { id: "carousel", label: "Carousel", icon: <Layers className="w-3.5 h-3.5" /> },
];

// Platform compatibility: which platforms support each content type
const CONTENT_PLATFORM_COMPAT: Record<string, Platform[]> = {
  image: ["facebook", "instagram", "linkedin"],
  video: ["facebook", "instagram", "linkedin", "youtube", "tiktok"],
  reel: ["facebook", "instagram", "youtube", "tiktok"],
  carousel: ["facebook", "instagram"],
};

function getCompatiblePlatforms(ct: ContentType): Platform[] {
  return CONTENT_PLATFORM_COMPAT[ct] || [];
}

function getCompatibleContentTypes(selectedPlatforms: Platform[]): Set<string> {
  if (selectedPlatforms.length === 0) return new Set(Object.keys(CONTENT_PLATFORM_COMPAT));
  const result = new Set<string>();
  for (const [type, platforms] of Object.entries(CONTENT_PLATFORM_COMPAT)) {
    if (selectedPlatforms.every((p) => platforms.includes(p))) result.add(type);
  }
  return result;
}

const ASSET_SOURCES = ["Canva Pro", "Envato Elements", "Pexels", "Shot by Team", "Client Provided", "Google Images", "AI Generated"];

type UploadedFile = CreatePostUploadFileState;

interface Props {
  open: boolean;
  onClose: () => void;
}

type ModalTab = "content" | "checklist" | "details";

function uploadErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "upload failed";
}

function uploadPathForSize(file: File): "proxy" | "resumable" {
  return file.size >= 4 * 1024 * 1024 ? "resumable" : "proxy";
}

export function CreatePostModal({ open, onClose }: Props) {
  const { createCard, workspaceId } = usePipeline();
  const { addToast } = useToast();
  const { currentUser } = useAuth();
  const [title, setTitle] = useState("");
  const [caption, setCaption] = useState("");
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
  const [showMediaPicker, setShowMediaPicker] = useState(false);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const dialogRef = useRef<HTMLDivElement>(null);

  // ESC key closes the modal
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Trap focus inside this dialog. Disabled while a nested overlay (the Media
  // Library picker or the validation error modal) is open so the trap does
  // not fight the nested dialog for focus.
  useFocusTrap(dialogRef, open && !showMediaPicker && validationErrors.length === 0);

  if (!open) return null;

  const compatiblePlatforms = getCompatiblePlatforms(contentType);
  const compatibleContentTypes = getCompatibleContentTypes(platforms);

  const togglePlatform = (p: Platform) => {
    setPlatforms((prev) => prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]);
  };

  const handleContentTypeChange = (ct: ContentType) => {
    setContentType(ct);
    const compat = CONTENT_PLATFORM_COMPAT[ct] || [];
    setPlatforms((prev) => prev.filter((p) => compat.includes(p)));
  };

  const toggleChecklist = (id: string) => {
    setChecklist((prev) => prev.map((c) => c.id === id ? { ...c, checked: !c.checked } : c));
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files;
    if (!selected) return;
    const selectedFiles = Array.from(selected);
    const acceptedFiles = selectedFiles.filter((file) => isDrivePublishableMediaMime(file.type, file.name));
    const rejectedCount = selectedFiles.length - acceptedFiles.length;
    if (rejectedCount > 0) {
      addToast("Post content uploads must be images or videos. Add documents in Source Vault.", "error");
    }
    const newFiles: UploadedFile[] = acceptedFiles.map((file) => {
      const id = Date.now().toString() + Math.random().toString(36).slice(2);
      const mimeType = normalizeDriveMimeType(file.type, file.name);
      rawFilesRef.current.set(id, file);
      return {
        id,
        name: file.name,
        size: file.size < 1024 * 1024 ? `${(file.size / 1024).toFixed(0)} KB` : `${(file.size / (1024 * 1024)).toFixed(1)} MB`,
        type: mimeType.startsWith("video") ? "video" : "image",
        preview: URL.createObjectURL(file),
        mimeType,
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
    if (!caption.trim()) missing.push("caption");
    if (!assetSource.trim()) missing.push("asset source");
    if (missing.length > 0) { setValidationErrors(missing); return; }

    setSubmitting(true);

    let thumbnailUrl = "";
    let thumbnailFileId: string | undefined;
    let thumbnailMimeType = "";
    const rawFiles: import("@/lib/types").RawFile[] = [];
    let filesForCard: UploadedFile[] = files;
    let uploadFailed = false;

    // Upload all files to Drive — NO BLOB FALLBACK.
    // Files upload concurrently (3-wide pool) instead of one-at-a-time, while
    // preserving order: rawFiles[0] stays the master/thumbnail. Any failure is
    // fail-closed, so the card is not created with missing files.
    if (files.length > 0) {
      try {
      const { uploadManyToDrive, reportUploadFailure } = await import("@/lib/drive-upload");

      // New files that actually need uploading, tagged with their original index.
      // Successfully uploaded files are stored on `files`, so a retry after a
      // partial failure only sends the failed files.
      const pending = getPendingCreatePostUploads(files, rawFilesRef.current);

      if (pending.length > 0) {
        setUploadingFileName(pending.length === 1 ? pending[0].file.name : `Uploading ${pending.length} files`);
        setUploadProgress(0);
        const items = await uploadManyToDrive(pending.map((p) => p.file), "raw-files", {
          concurrency: 3,
          onProgress: setUploadProgress,
        });
        const applied = applyCreatePostUploadResults(files, pending, items);
        filesForCard = applied.files;
        if (applied.successes.length > 0) {
          setFiles(applied.files);
        }
        const failure = applied.failures[0];
        if (failure) {
          const errorMessage = uploadErrorMessage(failure.error);
          addToast(`Couldn't upload ${failure.file.name}: ${errorMessage}`, "error");
          await reportUploadFailure({
            phase: "create_post_batch_upload",
            route: "/api/drive/upload-failure",
            uploadPath: uploadPathForSize(failure.file),
            postTitle: title.trim(),
            folder: "raw-files",
            fileName: failure.file.name,
            mimeType: normalizeDriveMimeType(failure.file.type, failure.file.name),
            fileSize: failure.file.size,
            batchTotal: pending.length,
            batchFailed: applied.failures.length || 1,
            errorMessage,
            errorDetail: failure.error.stack,
          });
          uploadFailed = true;
        }
      }

      if (!uploadFailed) {
        const withPlayback = filesForCard.map((file) => ({ ...file }));
        let playbackModule: typeof import("@/lib/media-playback") | null = null;
        try {
          playbackModule = await import("@/lib/media-playback");
        } catch {
          playbackModule = null;
        }
        if (playbackModule) {
          for (let i = 0; i < withPlayback.length; i++) {
            const f = withPlayback[i];
            const rawMimeType = f.mimeType || (f.type === "video" ? "video/mp4" : "image/jpeg");
            if (!rawMimeType.startsWith("video/") || f.playbackUrl) continue;
            const sourceFile = rawFilesRef.current.get(f.id);
            if (!sourceFile) continue;
            if (!playbackModule.canUploadPlaybackCopy(sourceFile, rawMimeType)) continue;

            try {
              setUploadingFileName(`Optimizing playback for ${f.name}`);
              setUploadProgress(0);
              const playback = await playbackModule.uploadVideoPlaybackCopy(sourceFile);
              withPlayback[i] = {
                ...f,
                playbackUrl: playback.playbackUrl,
                playbackStorageKey: playback.playbackStorageKey,
              };
            } catch (err) {
              const errorMessage = uploadErrorMessage(err);
              await reportUploadFailure({
                phase: "create_post_playback_upload",
                route: "/api/media/playback-upload",
                uploadPath: uploadPathForSize(sourceFile),
                postTitle: title.trim(),
                folder: "raw-files",
                fileName: sourceFile.name,
                mimeType: rawMimeType,
                fileSize: sourceFile.size,
                errorMessage,
                errorDetail: err instanceof Error ? err.stack : undefined,
              });
              addToast(`Uploaded ${f.name}, but fast video playback was skipped.`, "warning");
            }
          }
        }
        filesForCard = withPlayback;
        setFiles(withPlayback);
      }

      // Rebuild rawFiles in the original file order (master = index 0).
      if (!uploadFailed) {
        for (let i = 0; i < filesForCard.length; i++) {
          const f = filesForCard[i];
          if (f.driveUrl) {
            const rawMimeType = f.mimeType || (f.type === "video" ? "video/mp4" : "image/jpeg");
            const publishUrl = f.publishUrl || (f.driveFileId ? getPublicDriveDownloadUrl(f.driveFileId) : f.driveUrl);
            const driveProxyUrl = f.driveProxyUrl || f.driveUrl;
            warmBrowserImagePreview(driveProxyUrl, { mimeType: rawMimeType, fileName: f.name });
            rawFiles.push({
              name: f.name,
              url: publishUrl,
              fileId: f.driveFileId,
              publishUrl,
              driveProxyUrl,
              playbackUrl: f.playbackUrl,
              playbackStorageKey: f.playbackStorageKey,
              usageType: i === 0 ? "master" : "supplementary",
              mimeType: rawMimeType,
              size: f.driveSize || 0,
              uploadedAt: new Date().toISOString(),
            });
            if (i === 0) {
              thumbnailUrl = driveProxyUrl;
              thumbnailFileId = f.driveFileId;
              thumbnailMimeType = rawMimeType;
              if (rawMimeType.startsWith("video/")) {
                const sourceFile = rawFilesRef.current.get(f.id);
                if (sourceFile) {
                  try {
                    setUploadingFileName(`Generating thumbnail for ${f.name}`);
                    setUploadProgress(0);
                    const { createVideoPosterFile } = await import("@/lib/video-poster");
                    const posterFile = await createVideoPosterFile(sourceFile);
                    const [posterItem] = await uploadManyToDrive([posterFile], "thumbnails", {
                      concurrency: 1,
                      onProgress: setUploadProgress,
                    });
                    if (posterItem?.result) {
                      thumbnailUrl = posterItem.result.url;
                      thumbnailFileId = posterItem.result.fileId;
                      thumbnailMimeType = posterItem.result.mimeType || "image/jpeg";
                    } else if (posterItem?.error) {
                      console.warn("[create-post] video poster upload failed:", posterItem.error.message);
                    }
                  } catch (err) {
                    console.warn("[create-post] video poster generation failed:", err);
                  }
                }
              }
            }
            continue;
          }
        }
        if (rawFiles.length < filesForCard.length) {
          addToast("Some files are not uploaded yet. Retry the failed uploads before creating the post.", "error");
          uploadFailed = true;
        }
      }
      } catch (err) {
        // Fail-closed: any throw in the upload phase — including a code-split
        // chunk that won't load after a deploy — marks the upload failed so the
        // card is never created with missing files, and `submitting` resets in
        // the guard below instead of leaving the modal stuck on "Preparing…".
        addToast(`Couldn't upload your files: ${uploadErrorMessage(err)}. If this keeps happening, refresh the page.`, "error");
        uploadFailed = true;
      }
    }

    if (uploadFailed) {
      setSubmitting(false);
      setUploadProgress(0);
      setUploadingFileName("");
      return; // Don't create card with missing files
    }

    try {
    createCard({
      title: title.trim(),
      stage: "ideas",
      platforms,
      contentType,
      thumbnailUrl,
      caption: caption.trim() || undefined,
      scheduledDate: scheduledDate || undefined,
      scheduledTime: scheduledTime || undefined,
      createdBy: currentUser.name,
      assetSource: assetSource || undefined,
      checklist,
      licenseFileId: licenseFileId || undefined,
      mediaIds: filesForCard.map((file) => file.mediaAssetId).filter((id): id is string => !!id),
      notes: notes.trim() ? `${currentUser.name} (${formatDateTimeCompact(new Date())}): ${notes.trim()}` : undefined,
      sourceVault: (designLink || driveFolder || rawFiles.length > 0) ? {
        designLink: designLink || undefined,
        driveFolder: driveFolder || undefined,
        thumbnailFileId,
        thumbnailMimeType: thumbnailMimeType || undefined,
        rawFiles: rawFiles.length > 0 ? rawFiles : undefined,
      } : undefined,
    });

    // Insert uploaded files into media_assets so they appear in Media Library
    // Note: usedIn omitted — post ID is still a temp timestamp at this point
    for (const rf of rawFiles) {
      try {
        await ensureMediaAsset({
          name: rf.name,
          url: rf.playbackUrl || rf.driveProxyUrl || rf.url,
          fileType: rf.mimeType?.startsWith("video") ? "video" : "image",
          folder: "Content Engine Uploads",
          addedBy: currentUser.name,
          workspaceId,
        });
      } catch (err) {
        console.error("[create-post] media_assets insert failed:", err);
      }
    }

    rawFilesRef.current.clear();
    setTitle(""); setCaption(""); setPlatforms([]); setContentType("video");
    setScheduledDate(""); setScheduledTime(""); setFiles([]); setAssetSource(""); setAssetSourceOther(false); setLicenseFileId("");
    setDesignLink(""); setDriveFolder(""); setNotes(""); setActiveTab("content");
    setChecklist(DEFAULT_CHECKLIST.map((c) => ({ ...c })));
    onClose();
    } finally {
      // Guarantee the submit button re-enables and the progress label clears,
      // even if createCard or a post-upload step throws synchronously, so the
      // modal can never strand on "Preparing…"/"Uploading…".
      setSubmitting(false);
      setUploadProgress(0);
      setUploadingFileName("");
    }
  };

  const addMediaPickerSelections = (results: MediaPickerSelection[]) => {
    setFiles((prev) => [...prev, ...results.map((result) => {
      const id = Date.now().toString() + Math.random().toString(36).slice(2);
      const isVideo = result.mimeType?.startsWith("video") || false;
      const fileId = result.fileId || driveFileIdFromUrl(result.driveProxyUrl || result.url) || undefined;
      return {
        id,
        name: result.name,
        size: "Library",
        type: isVideo ? "video" : "image",
        preview: result.url,
        driveUrl: result.url,
        driveProxyUrl: result.driveProxyUrl || result.url,
        publishUrl: result.publishUrl || (fileId ? getPublicDriveDownloadUrl(fileId) : result.url),
        playbackUrl: result.playbackUrl,
        playbackStorageKey: result.playbackStorageKey,
        driveFileId: fileId,
        mediaAssetId: result.mediaAssetId,
        mimeType: result.mimeType,
        driveSize: result.size,
      } satisfies UploadedFile;
    })]);
    setShowMediaPicker(false);
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
        <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="create-post-title" className="bg-white dark:bg-[#151518] rounded-2xl border border-gray-200 dark:border-white/[0.08] shadow-2xl w-full max-w-[580px] max-h-[90dvh] flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-white/[0.06] shrink-0">
            <h2 id="create-post-title" className="text-[15px] font-semibold text-gray-900 dark:text-white">Create New Post</h2>
            <button onClick={onClose} aria-label="Close create post" className="p-1.5 rounded-md hover:bg-gray-100 dark:hover:bg-white/[0.06] text-gray-400 cursor-pointer"><X className="w-4 h-4" aria-hidden="true" /></button>
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
                  <input ref={fileInputRef} type="file" multiple accept="image/*,video/*,.heic,.heif" onChange={handleFileSelect} className="hidden" />

                  {files.length > 0 && (
                    <div className="grid grid-cols-3 gap-2 mb-2">
                      {files.map((file) => (
                        <div key={file.id} className="relative group rounded-lg overflow-hidden border border-gray-200 dark:border-white/[0.08] bg-gray-50 dark:bg-white/[0.03]">
                          {file.type === "image" ? (
                            <PreviewImage src={file.preview} alt={file.name} mimeType={file.mimeType} fileName={file.name} className="w-full aspect-square object-cover" />
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
                    <div className="flex gap-2">
                      <button type="button" onClick={() => fileInputRef.current?.click()} className="flex-1 p-6 rounded-xl border-2 border-dashed border-gray-200 dark:border-white/[0.1] flex flex-col items-center justify-center text-gray-400 dark:text-gray-500 hover:text-orange-500 hover:border-orange-300 dark:hover:border-orange-500/30 transition-colors cursor-pointer group">
                        <div className="w-10 h-10 rounded-xl bg-gray-50 dark:bg-white/[0.04] flex items-center justify-center mb-2 group-hover:bg-orange-50 dark:group-hover:bg-orange-500/10 transition-colors">
                          <Upload className="w-5 h-5" />
                        </div>
                        <p className="text-[12px] font-medium text-gray-600 dark:text-gray-400">Upload from device</p>
                        <p className="text-[10px] text-gray-300 dark:text-gray-600 mt-0.5">First file = card thumbnail</p>
                      </button>
                      <button type="button" onClick={() => setShowMediaPicker(true)} className="flex-1 p-6 rounded-xl border-2 border-dashed border-gray-200 dark:border-white/[0.1] flex flex-col items-center justify-center text-gray-400 dark:text-gray-500 hover:text-blue-500 hover:border-blue-300 dark:hover:border-blue-500/30 transition-colors cursor-pointer group">
                        <div className="w-10 h-10 rounded-xl bg-gray-50 dark:bg-white/[0.04] flex items-center justify-center mb-2 group-hover:bg-blue-50 dark:group-hover:bg-blue-500/10 transition-colors">
                          <FolderOpen className="w-5 h-5" />
                        </div>
                        <p className="text-[12px] font-medium text-gray-600 dark:text-gray-400">Browse Library</p>
                        <p className="text-[10px] text-gray-300 dark:text-gray-600 mt-0.5">Pick from existing media</p>
                      </button>
                    </div>
                  )}
                </div>

                {/* Platforms */}
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-[0.08em]">Platforms <span className="text-red-400">*</span></label>
                  <div className="flex flex-wrap gap-1.5">
                    {ALL_PLATFORMS.map((p) => {
                      const isCompat = compatiblePlatforms.includes(p.id);
                      const active = platforms.includes(p.id);
                      return (
                        <button key={p.id} type="button" onClick={() => isCompat && togglePlatform(p.id)} disabled={!isCompat}
                          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium border transition-colors ${
                            !isCompat
                              ? "opacity-30 cursor-not-allowed border-gray-200 text-gray-400 dark:border-white/[0.04] dark:text-gray-600"
                              : active
                                ? "bg-orange-50 border-orange-200 text-orange-700 dark:bg-orange-500/10 dark:border-orange-500/30 dark:text-orange-400 cursor-pointer"
                                : "bg-white border-gray-200 text-gray-500 hover:bg-gray-50 dark:bg-transparent dark:border-white/[0.08] dark:text-gray-400 cursor-pointer"
                          }`}>
                          <PlatformIcon platform={p.id} className="w-3.5 h-3.5" />{p.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Content type */}
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-[0.08em]">Content Type <span className="text-red-400">*</span></label>
                  <div className="flex flex-wrap gap-1.5">
                    {contentTypes.map((ct) => {
                      const isCompat = compatibleContentTypes.has(ct.id);
                      const active = contentType === ct.id;
                      return (
                        <button key={ct.id} type="button" onClick={() => isCompat && handleContentTypeChange(ct.id)} disabled={!isCompat}
                          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium border transition-colors ${
                            !isCompat
                              ? "opacity-30 cursor-not-allowed border-gray-200 text-gray-400 dark:border-white/[0.04] dark:text-gray-600"
                              : active
                                ? "bg-gray-900 border-gray-900 text-white dark:bg-white dark:border-white dark:text-gray-900 cursor-pointer"
                                : "bg-white border-gray-200 text-gray-500 hover:bg-gray-50 dark:bg-transparent dark:border-white/[0.08] dark:text-gray-400 cursor-pointer"
                          }`}>
                          {ct.icon}{ct.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Caption */}
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-[0.08em]">Caption <span className="text-red-400">*</span> <span className="text-emerald-500 dark:text-emerald-400 text-[8px] normal-case font-medium">Posted to platforms</span></label>
                  <p className="text-[9px] text-gray-400 dark:text-gray-500 leading-relaxed -mt-0.5">The full text published with this post. Include hashtags, mentions, and CTAs. This is what n8n sends to each platform.</p>
                  <MentionTextarea value={caption} onChange={setCaption} placeholder="Write your caption... Type @ to mention team members" className="min-h-[120px] w-full bg-gray-50 dark:bg-white/[0.04] border border-gray-200 dark:border-white/[0.08] rounded-lg text-[12px] text-gray-800 dark:text-gray-200 placeholder:text-gray-400 dark:placeholder:text-gray-600 resize-y p-3 outline-none focus:ring-2 focus:ring-orange-100 dark:focus:ring-orange-500/10 focus:border-orange-400 transition-all" rows={6} />
                </div>

                {/* Post Date & Time */}
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-[0.08em]">Post Date & Time <span className="text-red-400">*</span></label>
                  <p className="text-[9px] text-gray-400 dark:text-gray-500 leading-relaxed -mt-0.5">When this post goes live on social media. n8n publishes automatically at this exact date and time.</p>
                  <div className="flex gap-2">
                    <input type="date" value={scheduledDate} onChange={(e) => setScheduledDate(e.target.value)} min={new Date().toISOString().slice(0, 10)} className={`${inputClass} flex-[3]`} required />
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
                  <p className="text-[9px] text-gray-400 dark:text-gray-500 leading-relaxed -mt-0.5 mb-1">Attach the license, model release, or proof of rights. Stored securely for copyright protection and compliance.</p>
                  {licenseFileId ? (
                    <div className="flex items-center gap-2 bg-emerald-50 dark:bg-emerald-500/5 border border-emerald-200 dark:border-emerald-500/20 rounded-lg px-3 py-2">
                      <span className="text-[11px] text-emerald-700 dark:text-emerald-400 font-medium flex-1">License uploaded</span>
                      <button type="button" onClick={() => setLicenseFileId("")} className="text-[10px] text-gray-400 hover:text-red-500 cursor-pointer">Remove</button>
                    </div>
                  ) : (
                    <button type="button" onClick={async () => {
                      const input = document.createElement("input");
                      input.type = "file";
                      input.accept = "image/*,.pdf,.txt,.doc,.docx";
                      input.onchange = async (ev) => {
                        const file = (ev.target as HTMLInputElement).files?.[0];
                        if (!file) return;
                        addToast("Uploading license...", "info");
                        let driveModule: typeof import("@/lib/drive-upload") | null = null;
                        try {
                          driveModule = await import("@/lib/drive-upload");
                          const [item] = await driveModule.uploadManyToDrive([file], "raw-files", { concurrency: 1 });
                          if (!item?.result) throw item?.error || new Error("License upload failed");
                          const result = item.result;
                          setLicenseFileId(result.fileId);
                          addToast("License uploaded", "success");
                        } catch (err) {
                          const errorMessage = uploadErrorMessage(err);
                          addToast("License upload failed. If this keeps happening, refresh the page.", "error");
                          try {
                            await driveModule?.reportUploadFailure({
                              phase: "create_post_license_upload",
                              route: "/api/drive/upload-failure",
                              uploadPath: uploadPathForSize(file),
                              postTitle: title.trim(),
                              folder: "raw-files",
                              fileName: file.name,
                              mimeType: normalizeDriveMimeType(file.type, file.name),
                              fileSize: file.size,
                              errorMessage,
                              errorDetail: err instanceof Error ? err.stack : undefined,
                            });
                          } catch { /* ignore */ }
                        }
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
                  <label className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-[0.08em]">Editable Design Link</label>
                  <input value={designLink} onChange={(e) => setDesignLink(e.target.value)} placeholder="https://www.canva.com/design/..." className={`${inputClass} font-mono text-[11px]`} />
                  <p className="text-[9px] text-gray-400 dark:text-gray-500 leading-relaxed">Optional Canva, Figma, or Adobe link for team revisions.</p>
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-[0.08em]">Asset Folder</label>
                  <input value={driveFolder} onChange={(e) => setDriveFolder(e.target.value)} placeholder="Paste a shared folder link" className={`${inputClass} font-mono text-[11px]`} />
                </div>
              </div>
            )}

            {/* Upload progress */}
            {submitting && uploadingFileName && (
              <div className="bg-white dark:bg-white/[0.03] rounded-xl border border-gray-200/60 dark:border-white/[0.06] p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-medium text-gray-600 dark:text-gray-300 truncate flex-1">{uploadingFileName}</span>
                  <span className="text-[10px] font-bold text-orange-500 tabular-nums ml-2">{uploadProgress >= 90 && uploadProgress < 100 ? "Finishing up..." : uploadProgress <= 0 ? "Preparing..." : uploadProgress + "%"}</span>
                </div>
                <div className="w-full h-1.5 rounded-full bg-gray-100 dark:bg-white/[0.06] overflow-hidden">
                  <div className="h-full rounded-full bg-gradient-to-r from-orange-500 to-amber-500 transition-all duration-300" style={{ width: `${uploadProgress}%` }} />
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-2 pt-2">
              <Button type="button" variant="outline" onClick={onClose} disabled={submitting} className="flex-1 h-10 rounded-lg text-[12px]">Cancel</Button>
              <Button type="submit" disabled={submitting} className="reach-action-button flex-1 h-10 rounded-lg bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 text-white text-[12px] disabled:opacity-40 shadow-sm">
                {submitting ? "Uploading..." : "Create Post"}
              </Button>
            </div>
          </form>
        </div>
      </div>

      {/* Media Library Picker */}
      {showMediaPicker && (
        <MediaPicker
          open
          onClose={() => setShowMediaPicker(false)}
          folder="raw-files"
          defaultTab="library"
          onSelect={(result) => {
            addMediaPickerSelections([result]);
          }}
          onSelectMany={addMediaPickerSelections}
        />
      )}

      {/* Validation Error Modal */}
      <ValidationErrorModal errors={validationErrors} onClose={() => setValidationErrors([])} />
    </>
  );
}
