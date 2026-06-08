"use client";

import { RawImage } from "@/components/raw-image";
import { useState, useEffect, useRef, useMemo } from "react";
import { usePipeline } from "@/lib/pipeline-context";
import { PIPELINE_COLUMNS, PipelineStage, ALL_PLATFORMS, Platform } from "@/lib/types";
import { logAudit, fetchAuditLogs, AuditEntry } from "@/lib/audit";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import {
  X, Calendar, Clock, ChevronRight, CheckCircle2, MessageSquare,
  ArrowRightLeft, Pencil, Save, ExternalLink, Type, Trash2, Send,
  Upload, FolderOpen, Link2, FileText, History, Image as ImageIcon,
  FileVideo, Paperclip, AlertCircle, Maximize2, Sparkles, Star,
} from "lucide-react";
import { PlatformIcon } from "./platform-icons";
import { MentionTextarea } from "./mention-textarea";
import { RichComment } from "./rich-comment";
import { MediaPicker } from "./media-picker";
import { InlineEdit } from "./inline-edit";
import { ValidationErrorModal } from "./validation-error-modal";
import { useAuth } from "@/lib/auth-context";
import { useTeam } from "@/lib/team-context";
import { useToast } from "@/lib/toast-context";
import { ensureMediaAsset } from "@/lib/media-assets";
import { isDrivePublishableMediaMime, normalizeDriveMimeType } from "@/lib/drive-policy";
import { formatDate, formatDateTime, formatDateShort, formatDateTimeCompact } from "@/lib/utils";
import { useFocusTrap } from "./use-focus-trap";
import { isPipelineApproverRole } from "@/lib/roles";

// Strict @mention pattern — an @ followed by a name-like token. Used so a
// pasted email or URL containing "@" does not trigger a phantom mention.
const MENTION_RE = /@[a-zA-Z][\w.-]*/;

type DrawerTab = "content" | "vault" | "audit";

function uploadErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}

function uploadPathForSize(file: File): "proxy" | "resumable" {
  return file.size >= 4 * 1024 * 1024 ? "resumable" : "proxy";
}

export function AssetReviewDrawer() {
  const { selectedCard, isDrawerOpen, isEditingOnOpen, closeDrawer, moveCard, requestReapproval, submitKickback, updateCard, deleteCard, workspaceId } = usePipeline();
  const { addToast } = useToast();
  const { currentUser, accessToken } = useAuth();
  const { members } = useTeam();
  const currentMember = useMemo(
    () => members.find((m) => m.email === currentUser.email),
    [members, currentUser.email],
  );
  const userIsApprover = useMemo(() => {
    return isPipelineApproverRole(currentMember?.role || currentUser.role);
  }, [currentMember?.role, currentUser.role]);
  const [revisionMode, setRevisionMode] = useState(false);
  const [revisionFeedback, setRevisionFeedback] = useState("");
  const [editDate, setEditDate] = useState("");
  const [editTime, setEditTime] = useState("");
  const [dateEditing, setDateEditing] = useState(false);
  const [newComment, setNewComment] = useState("");
  const [activeTab, setActiveTab] = useState<DrawerTab>("content");
  const [showMediaPicker, setShowMediaPicker] = useState<"thumbnail" | "content" | null>(null);
  const prevCardRef = useRef<string | null>(null);
  const viewLoggedRef = useRef<string | null>(null);

  // Resolve actual video URL for video/reel cards (may differ from thumbnailUrl)
  const resolvedVideoUrl = useMemo(() => {
    if (!selectedCard) return null;
    if (selectedCard.contentType !== "video" && selectedCard.contentType !== "reel") return null;

    // Check sourceVault.rawFiles for a video file
    const rawVideo = selectedCard.sourceVault?.rawFiles?.find((f) => f.mimeType?.startsWith("video/"));
    if (rawVideo) return rawVideo.url;

    // Check media_ids for a file that isn't the thumbnail image
    const thumbFileId = selectedCard.thumbnailUrl?.match(/[?&]id=([^&]+)/)?.[1];
    const videoId = selectedCard.mediaIds?.find((id) => id !== thumbFileId);
    if (videoId) return `/api/drive/stream?id=${videoId}`;

    return null;
  }, [selectedCard]);

  // Source Vault state
  const [designLink, setDesignLink] = useState("");
  const [driveFolder, setDriveFolder] = useState("");
  const [vaultSaving, setVaultSaving] = useState(false);

  // Audit Trail state
  const [auditLogs, setAuditLogs] = useState<AuditEntry[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);

  // Asset replacement state
  const assetInputRef = useRef<HTMLInputElement>(null);
  const rawFileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadingFileName, setUploadingFileName] = useState("");
  const [showLightbox, setShowLightbox] = useState(false);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [pendingDelete, setPendingDelete] = useState(false);
  const drawerRef = useRef<HTMLDivElement>(null);

  // ESC closes lightbox first, then the drawer
  useEffect(() => {
    if (!isDrawerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (showLightbox) setShowLightbox(false);
      else if (pendingDelete) setPendingDelete(false);
      else closeDrawer();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isDrawerOpen, showLightbox, pendingDelete, closeDrawer]);

  useEffect(() => {
    if (selectedCard && isEditingOnOpen && prevCardRef.current !== selectedCard.id) {
      setDateEditing(true);
      setEditDate(selectedCard.scheduledDate || "");
      setEditTime(selectedCard.scheduledTime || "");
      prevCardRef.current = selectedCard.id;
    }
    if (selectedCard && prevCardRef.current !== selectedCard.id) {
      // Sync vault inputs from card
      setDesignLink(selectedCard.sourceVault?.designLink || "");
      setDriveFolder(selectedCard.sourceVault?.driveFolder || "");
      setActiveTab("content");
      setShowLightbox(false);
      prevCardRef.current = selectedCard.id;
    }
    if (!isDrawerOpen) {
      setRevisionMode(false);
      setRevisionFeedback("");
      setDateEditing(false);
      setNewComment("");
      setActiveTab("content");
      setShowLightbox(false);
      prevCardRef.current = null;
      viewLoggedRef.current = null;
    }
  }, [selectedCard, isEditingOnOpen, isDrawerOpen]);

  // ─── Debounced "Card Viewed" audit log ───
  useEffect(() => {
    if (!selectedCard || !isDrawerOpen) return;
    if (viewLoggedRef.current === selectedCard.id) return;
    const timer = setTimeout(() => {
      logAudit(selectedCard.id, currentUser.name, "card_viewed", `Viewed "${selectedCard.title}"`);
      viewLoggedRef.current = selectedCard.id;
    }, 800);
    return () => clearTimeout(timer);
  }, [selectedCard, isDrawerOpen, currentUser.name]);

  // ─── Fetch audit logs eagerly when a card opens ───
  // Was lazy (only on audit tab activation), but the comment renderer needs
  // audit logs to recover the actual author for legacy notes that lost their
  // attribution (stored as "Revision Note" before commit 55d0312).
  useEffect(() => {
    if (!selectedCard) return;
    setAuditLoading(true);
    fetchAuditLogs(selectedCard.id).then((logs) => {
      setAuditLogs(logs);
      setAuditLoading(false);
    });
  }, [selectedCard]);

  // Build a content→user_name map from post_audit_logs so legacy notes that
  // lost their attribution (stored as the literal "Revision Note" before
  // commit 55d0312) can be recovered to the actual user who performed the
  // action. Must live BEFORE the early return below so the hook is called
  // on every render unconditionally (react-hooks/rules-of-hooks).
  const auditAuthorByContent = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of auditLogs) {
      if (a.details && a.user_name) {
        map.set(a.details, a.user_name);
        map.set(a.details.trim().toLowerCase(), a.user_name);
      }
    }
    return map;
  }, [auditLogs]);

  // Trap focus inside the drawer while it is open. Disabled while a nested
  // overlay (lightbox, delete confirmation, media picker, validation modal)
  // is showing so the trap does not fight the nested dialog for focus.
  useFocusTrap(
    drawerRef,
    isDrawerOpen && !!selectedCard && !showLightbox && !pendingDelete && !showMediaPicker && validationErrors.length === 0,
  );

  if (!selectedCard || !isDrawerOpen) return null;

  const currentColumn = PIPELINE_COLUMNS.find((c) => c.id === selectedCard.stage);
  const checklist = selectedCard.checklist || [];
  const checkedCount = checklist.filter((c) => c.checked).length;
  const totalChecklist = checklist.length;
  const allChecked = checkedCount === totalChecklist;
  const isRepurposed = selectedCard.title?.startsWith("[Repurposed]") || false;

  const toggleChecklistItem = (itemId: string) => {
    updateCard(selectedCard.id, { checklist: checklist.map((c) => c.id === itemId ? { ...c, checked: !c.checked } : c) });
  };

  const stages: PipelineStage[] = ["ideas", "awaiting_approval", "revision_needed", "approved_scheduled", "posted"];
  const idx = stages.indexOf(selectedCard.stage);
  const nextStage = idx < stages.length - 1 ? stages[idx + 1] : null;
  const nextColumn = nextStage ? PIPELINE_COLUMNS.find((c) => c.id === nextStage) : null;

  // Parse the concatenated notes field into individual comments. Notes are
  // stored as `Author (date): content\n\nAuthor (date): content\n\n...`, but a
  // single comment may contain its own `\n\n` paragraph breaks. The naive
  // split("\n\n") shreds multi-paragraph comments into anonymous "??" rows.
  // Coalesce any chunk without an `Author (date):` prefix back into the
  // previous chunk as a continuation paragraph.
  const noteLines = (() => {
    if (!selectedCard.notes) return [];
    const chunks = selectedCard.notes.split("\n\n").filter(Boolean);
    const merged: string[] = [];
    const authorPrefix = /^.+?\s*\([^)]+\):\s*/;
    for (const chunk of chunks) {
      const looksLikeNewNote =
        authorPrefix.test(chunk) || chunk.startsWith("Fix submitted");
      if (looksLikeNewNote || merged.length === 0) {
        merged.push(chunk);
      } else {
        merged[merged.length - 1] += "\n\n" + chunk;
      }
    }
    return merged;
  })();

  // Helper: best-effort author recovery for a note whose stored author is
  // missing or the legacy "Revision Note" placeholder. Closes over the
  // auditAuthorByContent useMemo defined above the early return.
  const recoverAuthorFromAudit = (content: string): string | null => {
    if (!content) return null;
    return (
      auditAuthorByContent.get(content) ||
      auditAuthorByContent.get(content.trim().toLowerCase()) ||
      null
    );
  };

  const addComment = () => {
    if (!newComment.trim()) return;
    const trimmed = newComment.trim();
    const timestamp = formatDateTimeCompact(new Date());
    const comment = `${currentUser.name} (${timestamp}): ${trimmed}`;
    const existing = selectedCard.notes ? selectedCard.notes + "\n\n" : "";
    // DATA-002: only fire the @mention email once the DB write is confirmed
    // persisted. Firing eagerly emailed people for comments that never saved.
    updateCard(selectedCard.id, { notes: existing + comment }, (persisted) => {
      if (!persisted) return;
      // Strict mention test — a pasted email or URL containing "@" must not
      // trigger a mention notification.
      if (!MENTION_RE.test(trimmed)) return;
      const headers: HeadersInit = { "Content-Type": "application/json" };
      if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
      fetch("/api/notifications/mention", {
        method: "POST",
        headers,
        body: JSON.stringify({
          comment: trimmed,
          postTitle: selectedCard.title,
          postId: selectedCard.id,
          authorName: currentUser.name,
          authorEmail: currentUser.email,
        }),
      }).then(async (res) => {
        if (!res.ok) {
          const detail = await res.text().catch(() => "");
          throw new Error(`/api/notifications/mention failed with HTTP ${res.status}${detail ? `: ${detail.slice(0, 220)}` : ""}`);
        }
      }).catch((error) => console.error("[asset-review-drawer] mention notify failed:", error));
    });
    logAudit(selectedCard.id, currentUser.name, "comment_added", trimmed);
    setNewComment("");
  };

  const saveDate = () => {
    updateCard(selectedCard.id, { scheduledDate: editDate || undefined, scheduledTime: editTime || undefined });
    setDateEditing(false);
    addToast("Schedule updated", "info");
  };

  // ─── Replace primary asset (→ thumbnails/) ───
  const handleAssetReplace = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || uploading) return;
    if (!isDrivePublishableMediaMime(file.type, file.name)) {
      addToast("Cover uploads must be images or videos.", "error");
      if (assetInputRef.current) assetInputRef.current.value = "";
      return;
    }
    setUploading(true);
    setUploadingFileName(file.name);
    setUploadProgress(0);
    const prevUrl = selectedCard.thumbnailUrl;
    const blobUrl = URL.createObjectURL(file);
    updateCard(selectedCard.id, { thumbnailUrl: blobUrl }); // Optimistic preview
    try {
      const { uploadToDrive } = await import("@/lib/drive-upload");
      const result = await uploadToDrive(file, "thumbnails", selectedCard.id, setUploadProgress);
      URL.revokeObjectURL(blobUrl);
      updateCard(selectedCard.id, { thumbnailUrl: result.url });
      // Sync to Media Library — fire and catch so primary op is never blocked
      ensureMediaAsset({
        name: file.name,
        url: result.url,
        fileType: file.type.startsWith("video") ? "video" : "image",
        folder: "Pipeline Uploads",
        addedBy: currentUser.name,
        workspaceId,
        usedIn: selectedCard.id,
      }).catch((err) => console.error("[drawer] media_assets sync failed:", err));
      addToast("Cover image uploaded", "success");
    } catch (err) {
      // REVERT — never persist blob URL
      URL.revokeObjectURL(blobUrl);
      updateCard(selectedCard.id, { thumbnailUrl: prevUrl });
      const errorMessage = uploadErrorMessage(err);
      const { reportUploadFailure } = await import("@/lib/drive-upload");
      await reportUploadFailure({
        phase: "drawer_cover_upload",
        route: "/api/drive/upload-failure",
        uploadPath: uploadPathForSize(file),
        cardId: selectedCard.id,
        postTitle: selectedCard.title,
        folder: "thumbnails",
        fileName: file.name,
        mimeType: normalizeDriveMimeType(file.type, file.name),
        fileSize: file.size,
        errorMessage,
        errorDetail: err instanceof Error ? err.stack : undefined,
      });
      addToast(`Cover upload failed: ${errorMessage}. Try again.`, "error");
    }
    if (prevUrl?.startsWith("blob:")) URL.revokeObjectURL(prevUrl);
    logAudit(selectedCard.id, currentUser.name, "asset_replaced", `Replaced cover with ${file.name}`);
    if (assetInputRef.current) assetInputRef.current.value = "";
    setUploading(false);
    setUploadProgress(0);
    setUploadingFileName("");
  };

  // ─── Source Vault save ───
  const saveVault = async () => {
    setVaultSaving(true);
    const vault = { ...(selectedCard.sourceVault || {}), designLink: designLink || undefined, driveFolder: driveFolder || undefined };
    updateCard(selectedCard.id, { sourceVault: vault });
    logAudit(selectedCard.id, currentUser.name, "vault_updated", "Updated source vault links");
    addToast("Source vault saved", "success");
    setVaultSaving(false);
  };

  // ─── Raw file upload (→ raw-files/) — NEVER stores blob URLs ───
  const handleRawFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || uploading) return;
    setUploading(true);
    setUploadingFileName(file.name);
    setUploadProgress(0);
    try {
      const { uploadToDrive } = await import("@/lib/drive-upload");
      const result = await uploadToDrive(file, "raw-files", selectedCard.id, setUploadProgress);
      const resultMimeType = result.mimeType || normalizeDriveMimeType(file.type, file.name);
      const existingFiles = selectedCard.sourceVault?.rawFiles || [];
      const isFirstFile = existingFiles.length === 0;
      const newFile = {
        name: file.name,
        url: result.url,
        fileId: result.fileId,
        usageType: (isFirstFile ? "master" : "supplementary") as "master" | "supplementary",
        mimeType: resultMimeType,
        size: result.size || file.size,
        uploadedAt: new Date().toISOString(),
      };
      const rawFiles = [...existingFiles, newFile];
      updateCard(selectedCard.id, { sourceVault: { ...(selectedCard.sourceVault || {}), rawFiles } });
      // Sync to Media Library
      if (isDrivePublishableMediaMime(resultMimeType, file.name)) {
        ensureMediaAsset({
          name: file.name,
          url: result.url,
          fileType: resultMimeType.startsWith("video") ? "video" : "image",
          folder: "Pipeline Uploads",
          addedBy: currentUser.name,
          workspaceId,
          usedIn: selectedCard.id,
        }).catch((err) => console.error("[drawer] media_assets sync failed:", err));
      }
      logAudit(selectedCard.id, currentUser.name, "raw_file_uploaded", `Uploaded ${file.name} (${newFile.usageType})`);
      addToast(`${file.name} uploaded`, "success");
    } catch (err) {
      // NO BLOB FALLBACK — show error, let user retry
      const errorMessage = uploadErrorMessage(err);
      const { reportUploadFailure } = await import("@/lib/drive-upload");
      await reportUploadFailure({
        phase: "drawer_raw_file_upload",
        route: "/api/drive/upload-failure",
        uploadPath: uploadPathForSize(file),
        cardId: selectedCard.id,
        postTitle: selectedCard.title,
        folder: "raw-files",
        fileName: file.name,
        mimeType: normalizeDriveMimeType(file.type, file.name),
        fileSize: file.size,
        errorMessage,
        errorDetail: err instanceof Error ? err.stack : undefined,
      });
      addToast(`Upload failed: ${errorMessage}. Try again.`, "error");
    }
    if (rawFileInputRef.current) rawFileInputRef.current.value = "";
    setUploading(false);
    setUploadProgress(0);
    setUploadingFileName("");
  };

  return (
    <>
      <div onClick={closeDrawer} className="fixed inset-0 bg-black/20 dark:bg-black/50 z-40 transition-opacity duration-200" />
      <div ref={drawerRef} role="dialog" aria-modal="true" aria-label={`Post details: ${selectedCard.title || "Untitled post"}`} className="fixed right-0 top-0 bottom-0 w-full max-w-full md:max-w-[560px] z-50 flex flex-col bg-white dark:bg-[#0e0e11] border-l-0 md:border-l border-gray-200 dark:border-white/[0.08] shadow-2xl animate-in slide-in-from-right duration-200">

        {/* ─── Top Bar ─── */}
        <div className="flex items-center justify-between px-6 py-3.5 border-b border-gray-100 dark:border-white/[0.06] shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: currentColumn?.color }} />
            <span className="text-[13px] font-medium text-gray-500 dark:text-gray-400">{currentColumn?.title}</span>
            {isRepurposed && <Badge variant="outline" className="text-[9px] h-4 px-1.5 border-indigo-200 dark:border-indigo-500/20 text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-500/10">Repurposed</Badge>}
            {selectedCard.revised && <Badge variant="outline" className="text-[9px] h-4 px-1.5 border-violet-200 dark:border-violet-500/20 text-violet-600 dark:text-violet-400 bg-violet-50 dark:bg-violet-500/10">Revised</Badge>}
          </div>
          <div className="flex items-center gap-1.5">
            <button onClick={() => setPendingDelete(true)} aria-label="Delete post" className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-500/10 text-gray-400 hover:text-red-500 transition-all duration-150" title="Delete"><Trash2 className="w-3.5 h-3.5" aria-hidden="true" /></button>
            <button onClick={closeDrawer} aria-label="Close drawer" className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-white/[0.06] text-gray-400 transition-all duration-150"><X className="w-4 h-4" aria-hidden="true" /></button>
          </div>
        </div>

        {/* ─── Scrollable Body ─── */}
        <div className="flex-1 overflow-y-auto">

          {/* ══ SECTION 1: Post Identity ══ */}
          <div className="px-5 md:px-7 pt-5 md:pt-6 pb-4 md:pb-5 space-y-4">
            {/* Title */}
            <InlineEdit
              value={selectedCard.title}
              onSave={(v) => { updateCard(selectedCard.id, { title: v }); logAudit(selectedCard.id, currentUser.name, "title_edited", `Title changed to "${v}"`); }}
              placeholder="Add a title..."
              as="h2"
              className="text-[18px] font-bold text-slate-900 dark:text-white leading-snug tracking-tight"
              inputClassName="text-[18px] font-bold"
            />

            {/* Creator + date + time */}
            <div className="flex items-center gap-2 text-[10px] text-gray-400 dark:text-gray-500">
              {selectedCard.createdBy && (() => {
                const creator = members.find((m) => m.name === selectedCard.createdBy);
                return (
                  <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-gray-50 dark:bg-white/[0.03] border border-gray-100 dark:border-white/[0.05] font-medium text-gray-500 dark:text-gray-400">
                    {creator?.avatar ? (
                      <RawImage src={creator.avatar} alt={creator.name} className="w-4 h-4 rounded-full object-cover shrink-0" />
                    ) : (
                      <span className="w-4 h-4 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-[7px] font-bold text-white shrink-0">
                        {selectedCard.createdBy.split(" ").map((n) => n[0]).join("").slice(0, 2)}
                      </span>
                    )}
                    {selectedCard.createdBy}
                  </span>
                );
              })()}
              <span>{selectedCard.createdAt ? formatDateTime(selectedCard.createdAt) : ""}</span>
            </div>

            {/* Platforms — editable */}
            <div className="flex flex-wrap gap-1.5">
              {ALL_PLATFORMS.map((p) => {
                const active = selectedCard.platforms.includes(p.id);
                return (
                  <button key={p.id} onClick={() => {
                    const updated = active
                      ? selectedCard.platforms.filter((x) => x !== p.id)
                      : [...selectedCard.platforms, p.id];
                    if (updated.length === 0) return; // Must have at least 1
                    updateCard(selectedCard.id, { platforms: updated as Platform[] });
                  }}
                    className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium border transition-all cursor-pointer ${
                      active
                        ? "bg-orange-50 border-orange-200 text-orange-700 dark:bg-orange-500/10 dark:border-orange-500/30 dark:text-orange-400"
                        : "bg-white border-gray-200 text-gray-400 hover:bg-gray-50 dark:bg-transparent dark:border-white/[0.06] dark:text-gray-500 hover:text-gray-600"
                    }`}>
                    <PlatformIcon platform={p.id} className="w-3.5 h-3.5" />
                    <span>{p.label}</span>
                  </button>
                );
              })}
            </div>

            {/* Schedule — premium inline element */}
            <div className="bg-slate-50 dark:bg-white/[0.03] rounded-xl border border-gray-100 dark:border-white/[0.06] px-4 py-3">
              {dateEditing ? (
                <div className="flex gap-2 items-center">
                  <Input type="date" value={editDate} onChange={(e) => setEditDate(e.target.value)} min={new Date().toISOString().slice(0, 10)} className="h-9 flex-1 bg-white dark:bg-white/[0.04] border-orange-300 dark:border-orange-500/40 rounded-lg text-[12px] text-gray-800 dark:text-gray-200 ring-2 ring-orange-100 dark:ring-orange-500/20" autoFocus />
                  <Input type="time" value={editTime} onChange={(e) => setEditTime(e.target.value)} className="h-9 w-28 bg-white dark:bg-white/[0.04] border-orange-300 dark:border-orange-500/40 rounded-lg text-[12px] text-gray-800 dark:text-gray-200 ring-2 ring-orange-100 dark:ring-orange-500/20" />
                  <Button size="sm" onClick={saveDate} className="h-9 px-3 rounded-lg bg-orange-600 hover:bg-orange-700 text-white text-[11px]"><Save className="w-3 h-3" /></Button>
                  <button onClick={() => setDateEditing(false)} className="text-gray-400 hover:text-gray-600 cursor-pointer"><X className="w-4 h-4" /></button>
                </div>
              ) : (
                <button onClick={() => { setEditDate(selectedCard.scheduledDate || ""); setEditTime(selectedCard.scheduledTime || ""); setDateEditing(true); }}
                  className="w-full flex items-center gap-2 text-left cursor-pointer group">
                  <div className="w-8 h-8 rounded-lg bg-white dark:bg-white/[0.06] border border-gray-200 dark:border-white/[0.06] flex items-center justify-center shrink-0">
                    <Calendar className="w-4 h-4 text-orange-500" />
                  </div>
                  <div className="flex-1 min-w-0">
                    {selectedCard.scheduledDate ? (
                      <div className="flex items-center gap-2">
                        <span className="text-[13px] font-medium text-slate-800 dark:text-gray-200">
                          {formatDate(selectedCard.scheduledDate, { weekday: "short", month: "long", day: "numeric", year: "numeric" })}
                        </span>
                        {selectedCard.scheduledTime && (
                          <span className="text-[12px] text-gray-500 dark:text-gray-400 flex items-center gap-1 border-l border-gray-200 dark:border-white/[0.08] pl-2">
                            <Clock className="w-3 h-3" />{selectedCard.scheduledTime}
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className="text-[13px] text-orange-500 font-medium">Set date & time</span>
                    )}
                    <p className="text-[10px] text-gray-400 mt-0.5">Click to edit schedule</p>
                  </div>
                  <Pencil className="w-3.5 h-3.5 text-gray-300 group-hover:text-gray-500 transition-colors shrink-0" />
                </button>
              )}
            </div>
          </div>

          {/* ══ SECTION 2: Media Hero ══ */}
          <div className="px-5 md:px-7 pb-4 md:pb-5 space-y-3">
            <div className="flex items-center justify-between mb-1">
              <p className="text-[9px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-[0.1em]">Card Thumbnail <span className="text-red-400">*</span></p>
              <span className="text-[8px] text-gray-400 dark:text-gray-600 font-medium">Preview only — not posted</span>
            </div>
            <div className="relative w-full rounded-2xl overflow-hidden bg-gray-50 dark:bg-white/[0.03] group shadow-sm">
              {selectedCard.contentType === "video" ? (
                resolvedVideoUrl ? (
                  <video key={resolvedVideoUrl} src={resolvedVideoUrl} controls poster={selectedCard.thumbnailUrl || undefined} className="w-full aspect-video rounded-2xl bg-black object-contain" />
                ) : (
                  <video src={selectedCard.thumbnailUrl} controls className="w-full aspect-video rounded-2xl bg-black object-contain" />
                )
              ) : selectedCard.contentType === "reel" ? (
                <div className="w-full max-h-[400px] flex items-center justify-center bg-black">
                  {resolvedVideoUrl ? (
                    <video key={resolvedVideoUrl} src={resolvedVideoUrl} controls poster={selectedCard.thumbnailUrl || undefined} className="w-full max-h-[400px] rounded-2xl bg-black object-contain" />
                  ) : (
                    <video src={selectedCard.thumbnailUrl} controls className="w-full max-h-[400px] rounded-2xl bg-black object-contain" />
                  )}
                </div>
              ) : (
                <div
                  className="w-full flex items-center justify-center bg-gray-100 dark:bg-black/40 cursor-pointer"
                  onClick={() => selectedCard.thumbnailUrl && setShowLightbox(true)}
                >
                  <RawImage src={selectedCard.thumbnailUrl} alt={selectedCard.title} className="w-full h-auto object-contain transition-transform duration-300 group-hover:scale-[1.01]" />
                  <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none">
                    <div className="w-10 h-10 rounded-full bg-black/40 backdrop-blur-sm flex items-center justify-center">
                      <Maximize2 className="w-4 h-4 text-white" />
                    </div>
                  </div>
                </div>
              )}
              <select
                value={selectedCard.contentType}
                onChange={(e) => updateCard(selectedCard.id, { contentType: e.target.value as import("@/lib/types").ContentType })}
                className="absolute top-3 left-3 px-2.5 py-1 rounded-lg bg-black/50 backdrop-blur-sm text-[10px] text-white font-semibold capitalize tracking-wide appearance-none cursor-pointer hover:bg-black/70 transition-colors outline-none border-none"
              >
                <option value="video" className="text-gray-900">Video</option>
                <option value="image" className="text-gray-900">Image</option>
                <option value="reel" className="text-gray-900">Reel</option>
                <option value="carousel" className="text-gray-900">Carousel</option>
              </select>
              <input ref={assetInputRef} type="file" accept="image/*,video/*" onChange={handleAssetReplace} className="hidden" />
              <div className="absolute bottom-3 right-3 flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                <button onClick={() => setShowMediaPicker("thumbnail")} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-black/60 backdrop-blur-sm text-white text-[10px] font-medium hover:bg-black/80 cursor-pointer">
                  <ImageIcon className="w-3 h-3" />Library
                </button>
                <button onClick={() => assetInputRef.current?.click()} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-black/60 backdrop-blur-sm text-white text-[10px] font-medium hover:bg-black/80 cursor-pointer">
                  <Upload className="w-3 h-3" />Upload
                </button>
              </div>
            </div>

            {/* AI carousel/storyboard slide strip — only when the card has multiple AI assets. */}
            {(selectedCard.assetUrls && selectedCard.assetUrls.length > 1) ? (
              <div className="flex gap-2 overflow-x-auto pb-1">
                {selectedCard.assetUrls.map((url, idx) => {
                  const scene = selectedCard.carouselOutline?.[idx];
                  return (
                    <div key={`${idx}-${url}`} className="shrink-0 w-24" title={scene?.shot || `Slide ${idx + 1}`}>
                      <div className={`w-24 ${selectedCard.aspectRatio === "9:16" ? "aspect-[9/16]" : "aspect-[4/5]"} rounded-lg overflow-hidden border-2 ${idx === 0 ? "border-violet-500" : "border-gray-200 dark:border-white/[0.06]"}`}>
                        <RawImage src={url} alt={`Slide ${idx + 1}`} className="w-full h-full object-cover" />
                      </div>
                      <p className="mt-1 text-[9px] text-gray-500 dark:text-gray-400 line-clamp-2">
                        <span className="font-semibold text-gray-600 dark:text-gray-300">{idx + 1}.</span> {scene?.on_screen_text || scene?.shot || `Slide ${idx + 1}`}
                      </p>
                    </div>
                  );
                })}
              </div>
            ) : selectedCard.contentType === "carousel" ? (
              <div className="flex gap-2 overflow-x-auto pb-1">
                <div className="w-16 h-16 rounded-lg overflow-hidden border-2 border-orange-500 shrink-0"><RawImage src={selectedCard.thumbnailUrl} alt="Slide 1" className="w-full h-full object-cover" /></div>
                {[2, 3, 4].map((n) => (
                  <div key={n} className="w-16 h-16 rounded-lg border-2 border-dashed border-gray-200 dark:border-white/[0.08] flex items-center justify-center shrink-0 text-gray-300 dark:text-gray-600 hover:border-orange-300 dark:hover:border-orange-500/30 transition-colors cursor-pointer">
                    <span className="text-[9px] font-medium">Slide {n}</span>
                  </div>
                ))}
              </div>
            ) : null}

            {/* AI generation panel — shown only for AI-originated cards. */}
            {selectedCard.generatedByModel && (
              <div className="rounded-xl border border-violet-200/60 dark:border-violet-500/20 bg-violet-50/40 dark:bg-violet-500/[0.05] p-3 space-y-2.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-violet-600 dark:text-violet-400" />
                    <span className="text-[11px] font-semibold text-violet-700 dark:text-violet-300">AI Generated</span>
                    {selectedCard.aspectRatio && (
                      <span className="px-1.5 py-0.5 rounded font-mono text-[10px] bg-white/70 dark:bg-white/[0.04] text-gray-600 dark:text-gray-300">
                        {selectedCard.aspectRatio}
                      </span>
                    )}
                    {typeof selectedCard.revisionCount === "number" && selectedCard.revisionCount > 0 && (
                      <span className="px-1.5 py-0.5 rounded text-[10px] bg-violet-100 dark:bg-violet-500/15 text-violet-700 dark:text-violet-300">
                        v{selectedCard.revisionCount + 1}
                      </span>
                    )}
                  </div>
                </div>
                {typeof selectedCard.qualityScore === "number" && (
                  <div className="flex items-center gap-1.5 text-[10.5px] text-gray-700 dark:text-gray-300">
                    <Star className="w-3 h-3 text-amber-500" />
                    <span><span className="font-semibold">AI self-quality:</span> {selectedCard.qualityScore}/10</span>
                    <span className="text-gray-400 dark:text-gray-500">·</span>
                    <span className="text-gray-500 dark:text-gray-400">Model: {selectedCard.generatedByModel}</span>
                  </div>
                )}
                {selectedCard.approvalNotes && (
                  <div className="text-[11px] text-gray-700 dark:text-gray-300 leading-relaxed bg-white/60 dark:bg-white/[0.04] rounded-lg p-2.5 border border-violet-100 dark:border-violet-500/15">
                    <p className="text-[9px] font-bold uppercase tracking-wider text-violet-500 mb-1">Reviewer note from AI</p>
                    {selectedCard.approvalNotes}
                  </div>
                )}
                {selectedCard.visualBrief && (
                  <div className="text-[10.5px] text-gray-600 dark:text-gray-400 leading-snug">
                    <p className="text-[9px] font-bold uppercase tracking-wider text-gray-400 mb-0.5">Visual brief</p>
                    {selectedCard.visualBrief}
                  </div>
                )}
                {selectedCard.hashtags && selectedCard.hashtags.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {selectedCard.hashtags.map((tag) => (
                      <span key={tag} className="px-1.5 py-0.5 rounded bg-white dark:bg-white/[0.06] border border-gray-200/70 dark:border-white/[0.05] text-[10px] text-gray-600 dark:text-gray-300">
                        #{tag}
                      </span>
                    ))}
                  </div>
                )}
                {selectedCard.cta && (
                  <div className="text-[10.5px] text-gray-600 dark:text-gray-400">
                    <span className="text-[9px] font-bold uppercase tracking-wider text-gray-400">CTA</span> · {selectedCard.cta}
                  </div>
                )}
                {selectedCard.stage === "revision_needed" && (
                  <div className="text-[10.5px] text-gray-500 dark:text-gray-400 italic pt-1 border-t border-violet-100 dark:border-violet-500/15">
                    Save reviewer notes below. The AI will pick this up automatically and revise the draft in ~30 seconds.
                  </div>
                )}
              </div>
            )}

            {/* Upload progress bar */}
            {uploading && (
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

            {/* Publishable files — what n8n pulls for posting */}
            {(selectedCard.sourceVault?.rawFiles || []).length > 0 && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <p className="text-[9px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-[0.1em]">Content for Publishing</p>
                  <span className="text-[8px] text-emerald-500 dark:text-emerald-400 font-medium bg-emerald-50 dark:bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-200 dark:border-emerald-500/20">Auto-posted by n8n</span>
                </div>
                {(selectedCard.sourceVault?.rawFiles || []).map((file, i) => {
                  const isImage = /\.(jpg|jpeg|png|gif|webp|svg)$/i.test(file.name);
                  const isVideo = /\.(mp4|mov|avi|webm|mkv)$/i.test(file.name);
                  return (
                    <div key={i} className="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-white dark:bg-white/[0.02] border border-gray-100 dark:border-white/[0.05] hover:border-orange-200 dark:hover:border-orange-500/20 transition-colors group">
                      {isImage ? (
                        <RawImage src={file.url} alt={file.name} className="w-8 h-8 rounded object-cover shrink-0" />
                      ) : isVideo ? (
                        <div className="w-8 h-8 rounded bg-violet-50 dark:bg-violet-500/10 flex items-center justify-center shrink-0"><FileVideo className="w-3.5 h-3.5 text-violet-500" /></div>
                      ) : (
                        <div className="w-8 h-8 rounded bg-gray-50 dark:bg-white/[0.04] flex items-center justify-center shrink-0"><FileText className="w-3.5 h-3.5 text-gray-400" /></div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-[11px] font-medium text-gray-700 dark:text-gray-300 truncate">{file.name}</p>
                        <p className="text-[9px] text-gray-400">{formatDateShort(file.uploadedAt)}</p>
                      </div>
                      <a href={file.url} target="_blank" rel="noopener noreferrer" className="p-1 rounded hover:bg-gray-100 dark:hover:bg-white/[0.06] text-gray-300 hover:text-blue-500 transition-colors cursor-pointer" title="Open file">
                        <ExternalLink className="w-3 h-3" />
                      </a>
                      <button
                        onClick={() => {
                          const updated = (selectedCard.sourceVault?.rawFiles || []).filter((_, idx) => idx !== i);
                          updateCard(selectedCard.id, { sourceVault: { ...(selectedCard.sourceVault || {}), rawFiles: updated } });
                          if (file.url.startsWith("blob:")) URL.revokeObjectURL(file.url);
                          logAudit(selectedCard.id, currentUser.name, "raw_file_uploaded", `Removed ${file.name}`);
                          addToast(`${file.name} removed`, "info");
                        }}
                        className="p-1 rounded hover:bg-red-50 dark:hover:bg-red-500/10 text-gray-300 hover:text-red-500 transition-colors cursor-pointer" title="Remove file"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Dropzone */}
            <input ref={rawFileInputRef} type="file" accept="image/*,video/*,.pdf,.txt,.doc,.docx,.csv,.xls,.xlsx,.ppt,.pptx,.zip,.psd,.ai,.prproj,.aep,.sketch,.fig" onChange={handleRawFileUpload} className="hidden" />
            <div className="flex gap-2">
              <button disabled={uploading} onClick={() => rawFileInputRef.current?.click()} className={`flex-1 border border-dashed rounded-xl py-3 flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                !(selectedCard.sourceVault?.rawFiles?.length)
                  ? "border-red-300 dark:border-red-500/20 text-red-400 dark:text-red-400/70 hover:border-red-400 hover:bg-red-50/30 dark:hover:bg-red-500/[0.02]"
                  : "border-gray-200 dark:border-white/[0.08] text-gray-400 dark:text-gray-500 hover:text-orange-500 hover:border-orange-300 dark:hover:border-orange-500/30 hover:bg-orange-50/30 dark:hover:bg-orange-500/[0.02]"
              }`}>
                <Upload className="w-3.5 h-3.5" />
                <span className="text-[11px]">{(selectedCard.sourceVault?.rawFiles?.length) ? "Upload" : "Upload *"}</span>
              </button>
              <button onClick={() => setShowMediaPicker("content")} className="flex-1 border border-dashed border-gray-200 dark:border-white/[0.08] rounded-xl py-3 flex items-center justify-center gap-2 text-gray-400 dark:text-gray-500 hover:text-orange-500 hover:border-orange-300 dark:hover:border-orange-500/30 hover:bg-orange-50/30 dark:hover:bg-orange-500/[0.02] transition-all cursor-pointer">
                <FolderOpen className="w-3.5 h-3.5" />
                <span className="text-[11px]">Browse Library</span>
              </button>
            </div>
            {!(selectedCard.sourceVault?.rawFiles?.length) && (
              <p className="text-[9px] text-red-400/80 flex items-center gap-1"><AlertCircle className="w-2.5 h-2.5" />At least 1 file required — this is what gets posted to social platforms</p>
            )}
          </div>

          {/* ══ TAB BAR ══ */}
          <div className="flex items-center gap-0.5 px-5 md:px-7 mx-4 md:mx-7 mb-2 mt-2 border-b border-gray-100 dark:border-white/[0.06]">
            {([
              { id: "content" as DrawerTab, label: "Content", icon: <Type className="w-3 h-3" /> },
              { id: "vault" as DrawerTab, label: "Source Vault", icon: <FolderOpen className="w-3 h-3" /> },
              { id: "audit" as DrawerTab, label: "Audit Trail", icon: <History className="w-3 h-3" /> },
            ]).map((tab) => (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-1.5 px-4 py-3 min-h-[44px] text-[12px] font-semibold border-b-2 -mb-px transition-colors cursor-pointer ${activeTab === tab.id ? "border-orange-500 text-orange-700 dark:text-orange-400" : "border-transparent text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"}`}>
                {tab.icon}{tab.label}
              </button>
            ))}
          </div>

          {/* ══ TAB CONTENT ══ */}
          <div className="px-5 md:px-7 py-5 md:py-6 space-y-6 md:space-y-7">

            {/* ──── TAB 1: CONTENT ──── */}
            {activeTab === "content" && (
              <>
                {/* Caption — containerized card */}
                <div className="bg-slate-50/70 dark:bg-white/[0.02] rounded-xl border border-gray-100 dark:border-white/[0.05] p-5">
                  <label className="text-[11px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider flex items-center gap-1.5 mb-1"><Type className="w-3.5 h-3.5 text-orange-400" />Caption <span className="text-[8px] font-medium normal-case text-emerald-500 dark:text-emerald-400">Posted to platforms</span></label>
                  <p className="text-[9px] text-gray-400 dark:text-gray-500 leading-relaxed mb-2">The full text published with this post. Include hashtags, mentions, and CTAs.</p>
                  <InlineEdit
                    value={selectedCard.caption || ""}
                    onSave={(v) => { updateCard(selectedCard.id, { caption: v || undefined }); logAudit(selectedCard.id, currentUser.name, "content_edited", "Updated caption"); }}
                    placeholder="Click to write a caption..."
                    multiline
                    className="text-[14px] text-gray-700 dark:text-gray-300 leading-[1.7] whitespace-pre-wrap"
                    inputClassName="text-[14px] leading-[1.7]"
                  />
                </div>

                {/* ── Compliance Block ── */}
                <div className="bg-white dark:bg-white/[0.02] rounded-xl border border-gray-200/60 dark:border-white/[0.06] shadow-sm overflow-hidden">
                  {/* Asset Source */}
                  <AssetSourceBlock
                    value={selectedCard.assetSource || ""}
                    onChange={(v) => {
                      updateCard(selectedCard.id, { assetSource: v || undefined });
                      logAudit(selectedCard.id, currentUser.name, "content_edited", `Asset source: ${v}`);
                    }}
                  />

                  {/* License upload */}
                  <div className="p-4">
                    <label className="text-[9px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-[0.1em] flex items-center gap-1.5 mb-1">
                      <Paperclip className="w-3 h-3 text-orange-400" />License / Release
                      <span className="text-gray-300 dark:text-gray-600 text-[8px] normal-case ml-auto">Optional</span>
                    </label>
                    <p className="text-[9px] text-gray-400 dark:text-gray-500 leading-relaxed mb-2">Attach the license, model release, or proof of rights. Stored securely for copyright protection and compliance.</p>
                    {selectedCard.licenseFileId ? (
                      <div className="flex items-center gap-2.5 bg-emerald-50 dark:bg-emerald-500/5 border border-emerald-200/60 dark:border-emerald-500/20 rounded-lg px-3.5 py-2.5">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                        <span className="text-[11px] text-emerald-700 dark:text-emerald-400 font-medium flex-1">License on file</span>
                        <button onClick={() => { updateCard(selectedCard.id, { licenseFileId: undefined }); }} className="text-[10px] text-gray-400 hover:text-red-500 cursor-pointer transition-colors">Remove</button>
                      </div>
                    ) : (
                      <button
                        onClick={async () => {
                          const input = document.createElement("input");
                          input.type = "file";
                          input.accept = "image/*,.pdf,.txt,.doc,.docx";
                          input.onchange = async (ev) => {
                            const file = (ev.target as HTMLInputElement).files?.[0];
                            if (!file) return;
                            addToast("Uploading license...", "info");
                            try {
                              const { uploadToDrive } = await import("@/lib/drive-upload");
                              const result = await uploadToDrive(file, "raw-files", selectedCard.id);
                              updateCard(selectedCard.id, { licenseFileId: result.fileId });
                              logAudit(selectedCard.id, currentUser.name, "license_uploaded", `Uploaded license: ${file.name}`);
                              addToast("License uploaded", "success");
                            } catch (err) {
                              const { reportUploadFailure } = await import("@/lib/drive-upload");
                              const errorMessage = uploadErrorMessage(err);
                              await reportUploadFailure({
                                phase: "drawer_license_upload",
                                route: "/api/drive/upload-failure",
                                uploadPath: uploadPathForSize(file),
                                cardId: selectedCard.id,
                                postTitle: selectedCard.title,
                                folder: "raw-files",
                                fileName: file.name,
                                mimeType: normalizeDriveMimeType(file.type, file.name),
                                fileSize: file.size,
                                errorMessage,
                                errorDetail: err instanceof Error ? err.stack : undefined,
                              });
                              addToast("License upload failed", "error");
                            }
                          };
                          input.click();
                        }}
                        className="w-full border border-dashed border-gray-200 dark:border-white/[0.08] rounded-lg py-3 flex items-center justify-center gap-2 text-gray-400 dark:text-gray-500 hover:text-orange-500 hover:border-orange-300 dark:hover:border-orange-500/30 hover:bg-orange-50/30 dark:hover:bg-orange-500/[0.02] transition-all cursor-pointer"
                      >
                        <Upload className="w-3.5 h-3.5" />
                        <span className="text-[11px]">Upload license (PDF, TXT, or screenshot)</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Notes & Comments */}
                <div className="space-y-3">
                  <label className="text-[11px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider flex items-center gap-1.5"><MessageSquare className="w-3.5 h-3.5 text-orange-400" />Notes & Comments</label>
                  {noteLines.length > 0 && (
                    <div className="space-y-2">
                      {noteLines.map((note, i) => {
                        const closingMatch = note.match(/^(.+?)\s*\(([^)]+)\):\s*([\s\S]+)$/);
                        const hasAuthor = !!closingMatch;
                        const author = hasAuthor ? closingMatch![1].trim() : null;
                        const timestamp = hasAuthor ? closingMatch![2] : null;
                        const content = hasAuthor ? closingMatch![3].trim() : note;
                        const isRevisionNote = author === "Revision Note" || (content || "").startsWith("Fix submitted");
                        // For legacy notes that lost their author (stored as
                        // the literal "Revision Note" or with no prefix at
                        // all), look up the real user_name from the audit log
                        // by matching the note content against audit.details.
                        // This preserves the immutable audit trail even when
                        // the original storage format hardcoded a placeholder.
                        const recoveredAuthor =
                          (!author || author === "Revision Note")
                            ? recoverAuthorFromAudit(content)
                            : null;
                        const displayAuthor = recoveredAuthor
                          || (isRevisionNote
                            ? (author && author !== "Revision Note" ? author : "Team Member")
                            : author);
                        const authorMember = displayAuthor ? members.find((m) => m.name === displayAuthor) : null;
                        const initials = displayAuthor ? displayAuthor.split(" ").map((n) => n[0]).join("").slice(0, 2) : "??";
                        return (
                          <div key={i} className="flex gap-2.5 group">
                            {authorMember?.avatar ? (
                              <RawImage src={authorMember.avatar} alt={displayAuthor || ""} className="w-7 h-7 rounded-full object-cover shrink-0 mt-0.5" />
                            ) : (
                              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[8px] font-bold text-white shrink-0 mt-0.5 ${isRevisionNote ? "bg-gradient-to-br from-violet-500 to-purple-600" : "bg-gradient-to-br from-amber-400 to-orange-500"}`}>{initials}</div>
                            )}
                            <div className={`flex-1 min-w-0 rounded-xl px-3 py-2 border ${isRevisionNote ? "bg-violet-50 dark:bg-violet-500/5 border-violet-200/40 dark:border-violet-500/10" : "bg-amber-50 dark:bg-amber-500/5 border-amber-200/40 dark:border-amber-500/10"}`}>
                              {displayAuthor && (
                                <div className="flex items-center gap-2 mb-0.5">
                                  <span className={`text-[11px] font-semibold ${isRevisionNote ? "text-violet-800 dark:text-violet-300" : "text-amber-800 dark:text-amber-300"}`}>{displayAuthor}</span>
                                  {isRevisionNote && <span className="text-[8px] font-bold uppercase tracking-wider bg-violet-200 dark:bg-violet-500/20 text-violet-700 dark:text-violet-300 px-1.5 py-0.5 rounded-full">Revision</span>}
                                  {timestamp && <span className={`text-[9px] ${isRevisionNote ? "text-violet-600/60 dark:text-violet-400/40" : "text-amber-600/60 dark:text-amber-400/40"}`}>{timestamp}</span>}
                                </div>
                              )}
                              <RichComment text={content} className={`text-[12px] leading-relaxed ${isRevisionNote ? "text-violet-900 dark:text-violet-200" : "text-amber-900 dark:text-amber-200"}`} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {/* New comment */}
                  <div className="flex gap-2 items-start">
                    {currentUser.avatar ? (
                      <RawImage src={currentUser.avatar} alt={currentUser.name} className="w-7 h-7 rounded-full object-cover shrink-0 mt-0.5" />
                    ) : (
                      <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-[8px] font-bold text-white shrink-0 mt-0.5">{currentUser.initials}</div>
                    )}
                    <div className="flex-1 relative">
                      <MentionTextarea value={newComment} onChange={setNewComment} placeholder="Write a comment or note..." className="w-full min-h-[36px] bg-gray-50 dark:bg-white/[0.03] border border-gray-200 dark:border-white/[0.08] rounded-xl px-3 py-2 pr-10 text-[12px] text-gray-800 dark:text-gray-200 placeholder:text-gray-400 outline-none focus:ring-2 focus:ring-blue-200 dark:focus:ring-blue-500/20 focus:border-blue-300 dark:focus:border-blue-500/30 resize-none transition-all duration-150" rows={1} />
                      <button onClick={addComment} disabled={!newComment.trim()} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-md text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-500/10 disabled:text-gray-300 dark:disabled:text-gray-600 disabled:hover:bg-transparent cursor-pointer transition-all duration-150"><Send className="w-4 h-4" /></button>
                    </div>
                  </div>
                </div>

                {/* Checklist — containerized */}
                <div className="bg-slate-50/70 dark:bg-white/[0.02] rounded-xl border border-gray-100 dark:border-white/[0.05] p-5">
                  <div className="flex items-center justify-between mb-3">
                    <label className="text-[11px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider flex items-center gap-1.5"><CheckCircle2 className="w-3.5 h-3.5 text-orange-400" />Pre-Submit Checklist</label>
                    <span className={`text-[12px] font-bold tabular-nums ${allChecked ? "text-emerald-600" : "text-gray-400"}`}>{checkedCount}/{totalChecklist}</span>
                  </div>
                  <div className="w-full h-2 rounded-full bg-gray-200/60 dark:bg-white/[0.06] overflow-hidden mb-3">
                    <div className="h-full rounded-full bg-gradient-to-r from-orange-500 to-yellow-500 transition-all duration-300" style={{ width: `${(checkedCount / totalChecklist) * 100}%` }} />
                  </div>
                  <div className="space-y-1">
                    {checklist.map((item) => (
                      <label key={item.id} className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-white dark:hover:bg-white/[0.03] cursor-pointer transition-all duration-150">
                        <Checkbox checked={item.checked} onCheckedChange={() => toggleChecklistItem(item.id)} className="border-gray-300 dark:border-gray-600 data-[state=checked]:bg-orange-500 data-[state=checked]:border-orange-500 transition-all duration-150" />
                        <span className={`text-[13px] transition-all duration-150 leading-snug ${item.checked ? "text-gray-300 dark:text-gray-600 line-through" : "text-gray-700 dark:text-gray-300"}`}>{item.label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </>
            )}

            {/* ──── TAB 2: SOURCE VAULT ──── */}
            {activeTab === "vault" && (
              <>
                <div className="space-y-4">
                  {/* Design Link */}
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-[0.08em] flex items-center gap-1.5"><Link2 className="w-3 h-3 text-blue-500" />Editable Design Link</label>
                    <p className="text-[9px] text-gray-400 dark:text-gray-500 mb-1.5 leading-relaxed">Optional Canva, Figma, or Adobe link for team revisions.</p>
                    <div className="flex gap-2">
                      <Input value={designLink} onChange={(e) => setDesignLink(e.target.value)} placeholder="https://www.canva.com/design/..." className="flex-1 h-9 bg-gray-50 dark:bg-white/[0.03] border-gray-200 dark:border-white/[0.08] rounded-lg text-[12px] text-gray-800 dark:text-gray-200" />
                      {designLink && <a href={designLink} target="_blank" rel="noopener noreferrer" className="h-9 px-3 flex items-center rounded-lg bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 text-[11px] hover:bg-blue-100 dark:hover:bg-blue-500/20 transition-colors border border-blue-200 dark:border-blue-500/20"><ExternalLink className="w-3 h-3" /></a>}
                    </div>
                  </div>

                  {/* Drive Folder */}
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-[0.08em] flex items-center gap-1.5"><FolderOpen className="w-3 h-3 text-amber-500" />Drive / Folder Link</label>
                    <div className="flex gap-2">
                      <Input value={driveFolder} onChange={(e) => setDriveFolder(e.target.value)} placeholder="https://drive.google.com/drive/folders/..." className="flex-1 h-9 bg-gray-50 dark:bg-white/[0.03] border-gray-200 dark:border-white/[0.08] rounded-lg text-[12px] text-gray-800 dark:text-gray-200" />
                      {driveFolder && <a href={driveFolder} target="_blank" rel="noopener noreferrer" className="h-9 px-3 flex items-center rounded-lg bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400 text-[11px] hover:bg-amber-100 dark:hover:bg-amber-500/20 transition-colors border border-amber-200 dark:border-amber-500/20"><ExternalLink className="w-3 h-3" /></a>}
                    </div>
                  </div>

                  {/* Save links button */}
                  <Button onClick={saveVault} disabled={vaultSaving} size="sm" className="w-full h-9 rounded-lg bg-gray-900 dark:bg-white dark:text-gray-900 hover:bg-gray-800 text-white text-[12px] font-medium">
                    <Save className="w-3.5 h-3.5 mr-1.5" />{vaultSaving ? "Saving..." : "Save Links"}
                  </Button>
                </div>

                <Separator className="bg-gray-100 dark:bg-white/[0.06]" />

                {/* Raw Files */}
                <div className="space-y-3">
                  <label className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-[0.08em] flex items-center gap-1.5"><Paperclip className="w-3 h-3 text-violet-500" />Raw Project Files</label>

                  <input ref={rawFileInputRef} type="file" accept="image/*,video/*,.pdf,.txt,.doc,.docx,.csv,.xls,.xlsx,.ppt,.pptx,.zip,.psd,.ai,.prproj,.aep,.sketch,.fig" onChange={handleRawFileUpload} className="hidden" />
                  <button onClick={() => rawFileInputRef.current?.click()} className="w-full border-2 border-dashed border-gray-200 dark:border-white/[0.08] rounded-xl py-5 flex flex-col items-center gap-1.5 text-gray-400 hover:text-gray-500 hover:border-gray-300 dark:hover:border-white/[0.15] transition-colors cursor-pointer">
                    <Upload className="w-5 h-5" />
                    <span className="text-[11px]">Upload .prproj, .zip, .psd, or any project file</span>
                  </button>

                  {/* Uploaded files list */}
                  {(selectedCard.sourceVault?.rawFiles || []).length > 0 && (
                    <div className="space-y-1.5">
                      {selectedCard.sourceVault!.rawFiles!.map((file, i) => (
                        <div key={i} className="flex items-center gap-3 px-3 py-2.5 bg-gray-50 dark:bg-white/[0.03] rounded-xl border border-gray-200 dark:border-white/[0.06]">
                          <FileText className="w-4 h-4 text-violet-500 shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="text-[12px] font-medium text-gray-700 dark:text-gray-300 truncate">{file.name}</p>
                            <p className="text-[9px] text-gray-400">{formatDateTimeCompact(file.uploadedAt)}</p>
                          </div>
                          <a href={file.url} target="_blank" rel="noopener noreferrer" className="p-1.5 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-500/10 text-gray-400 hover:text-blue-500 transition-colors"><ExternalLink className="w-3.5 h-3.5" /></a>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}

            {/* ──── TAB 3: AUDIT TRAIL ──── */}
            {activeTab === "audit" && (
              <>
                {auditLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <div className="w-5 h-5 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin" />
                  </div>
                ) : auditLogs.length === 0 ? (
                  <div className="text-center py-12">
                    <History className="w-8 h-8 text-gray-300 dark:text-gray-600 mx-auto mb-2" />
                    <p className="text-[13px] text-gray-400">No audit history yet</p>
                    <p className="text-[11px] text-gray-300 dark:text-gray-600 mt-1">Actions on this card will appear here</p>
                  </div>
                ) : (
                  <div className="relative">
                    {/* Timeline line */}
                    <div className="absolute left-[13px] top-2 bottom-2 w-px bg-gray-200 dark:bg-white/[0.06]" />
                    <div className="space-y-0">
                      {auditLogs.map((entry) => {
                        const date = new Date(entry.created_at);
                        const timeStr = formatDateTimeCompact(date);
                        const actionColors: Record<string, string> = {
                          stage_change: "bg-blue-500",
                          revision_submitted: "bg-violet-500",
                          revision_requested: "bg-red-500",
                          content_edited: "bg-amber-500",
                          asset_replaced: "bg-emerald-500",
                          card_viewed: "bg-gray-400",
                          comment_added: "bg-orange-500",
                          vault_updated: "bg-sky-500",
                          raw_file_uploaded: "bg-purple-500",
                          title_edited: "bg-amber-500",
                        };
                        const dotColor = actionColors[entry.action_type] || "bg-gray-400";
                        const actionLabels: Record<string, string> = {
                          stage_change: "Stage Changed",
                          revision_submitted: "Fix Submitted",
                          revision_requested: "Revision Requested",
                          content_edited: "Content Edited",
                          asset_replaced: "Asset Replaced",
                          card_viewed: "Viewed",
                          comment_added: "Comment Added",
                          vault_updated: "Vault Updated",
                          raw_file_uploaded: "File Uploaded",
                          title_edited: "Title Edited",
                        };
                        return (
                          <div key={entry.id} className="relative flex gap-3 pb-4 pl-1">
                            <div className={`w-[10px] h-[10px] rounded-full ${dotColor} shrink-0 mt-1.5 z-10 ring-2 ring-white dark:ring-[#111]`} />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="text-[11px] font-semibold text-gray-800 dark:text-gray-200">{entry.user_name}</span>
                                <span className="text-[9px] text-gray-400">{timeStr}</span>
                              </div>
                              <p className="text-[10px] font-medium text-gray-500 dark:text-gray-400 mt-0.5">{actionLabels[entry.action_type] || entry.action_type}</p>
                              {entry.details && <p className="text-[11px] text-gray-600 dark:text-gray-400 mt-0.5 leading-relaxed">{entry.details}</p>}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* ─── Footer — context-aware actions ─── */}
        <div className="sticky bottom-0 px-6 pt-4 pb-[max(env(safe-area-inset-bottom),1rem)] border-t border-gray-100 dark:border-white/[0.06] shrink-0 space-y-2.5 bg-white dark:bg-[#0e0e11]">
          {revisionMode && (
            <div className="space-y-2">
              <div className="bg-red-50 dark:bg-red-500/5 rounded-xl border border-red-200 dark:border-red-500/20 p-3 space-y-2">
                <p className="text-[11px] font-semibold text-red-700 dark:text-red-400">What needs to be changed?</p>
                <MentionTextarea value={revisionFeedback} onChange={setRevisionFeedback} placeholder="e.g. Make the logo bigger... Type @ to mention someone" className="w-full min-h-[60px] bg-white dark:bg-[#111] border border-red-200 dark:border-red-500/20 rounded-lg p-2.5 text-[12px] text-gray-800 dark:text-gray-200 placeholder:text-gray-400 outline-none focus:ring-2 focus:ring-red-300 dark:focus:ring-red-500/30 resize-none transition-all duration-150" rows={3} />
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => { setRevisionMode(false); setRevisionFeedback(""); }} className="flex-1 h-9 rounded-lg text-[12px]">Cancel</Button>
                <Button size="sm" disabled={!revisionFeedback.trim()} onClick={() => {
                  const feedback = revisionFeedback.trim();
                  submitKickback(selectedCard.id, feedback);
                  addToast("Saving revision request...", "info");
                  setRevisionMode(false); setRevisionFeedback("");
                }} className="flex-1 h-9 rounded-lg bg-red-600 hover:bg-red-700 text-white text-[12px] shadow-sm disabled:opacity-40 transition-all duration-150">
                  Submit Revision Request
                </Button>
              </div>
            </div>
          )}

          {!revisionMode && selectedCard.stage === "awaiting_approval" && (
            userIsApprover ? (
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setRevisionMode(true)} className="flex-1 h-9 rounded-lg border-red-200 text-red-600 hover:bg-red-50 dark:border-red-500/20 dark:text-red-400 dark:hover:bg-red-500/10 bg-white dark:bg-transparent text-[12px] transition-all duration-150">
                  <ArrowRightLeft className="w-3.5 h-3.5 mr-1.5" />Request Revision
                </Button>
                <Button size="sm" onClick={() => {
                  const missing: string[] = [];
                  if (!selectedCard.scheduledDate) missing.push("scheduled date");
                  if (!selectedCard.scheduledTime) missing.push("scheduled time");
                  if (!selectedCard.thumbnailUrl) missing.push("thumbnail");
                  if (!selectedCard.sourceVault?.rawFiles?.length) missing.push("content for publishing");
                  if (!selectedCard.caption?.trim()) missing.push("caption");
                  if (!selectedCard.assetSource?.trim()) missing.push("asset source");
                  const unchk = checklist.filter((c) => !c.checked).length;
                  if (unchk > 0) missing.push(`${unchk} checklist item${unchk > 1 ? "s" : ""}`);
                  if (missing.length > 0) { setValidationErrors(missing); return; }
                  moveCard(selectedCard.id, "approved_scheduled");
                }}
                className="flex-1 h-9 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[12px] shadow-sm shadow-emerald-500/20 transition-all duration-150">
                  <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" />Approve Post
                </Button>
              </div>
            ) : (
              <div className="text-center py-1">
                <p className="text-[11px] text-amber-600 dark:text-amber-400 font-medium">Awaiting approver review</p>
              </div>
            )
          )}

          {!revisionMode && selectedCard.stage === "revision_needed" && (
            <div className="flex gap-2">
              <Button size="sm" onClick={() => {
                const missing: string[] = [];
                if (!selectedCard.scheduledDate) missing.push("scheduled date");
                if (!selectedCard.scheduledTime) missing.push("scheduled time");
                if (!selectedCard.thumbnailUrl) missing.push("thumbnail");
                if (!selectedCard.sourceVault?.rawFiles?.length) missing.push("content for publishing");
                if (!selectedCard.caption?.trim()) missing.push("caption");
                if (!selectedCard.assetSource?.trim()) missing.push("asset source");
                const unchk = checklist.filter((c) => !c.checked).length;
                if (unchk > 0) missing.push(`${unchk} checklist item${unchk > 1 ? "s" : ""}`);
                if (missing.length > 0) { setValidationErrors(missing); return; }
                requestReapproval(selectedCard.id);
              }} className="flex-1 h-9 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-[12px] shadow-sm shadow-violet-500/20 transition-all duration-150">
                <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" />Ready for Re-Approval
              </Button>
            </div>
          )}

          {!revisionMode && selectedCard.stage !== "awaiting_approval" && selectedCard.stage !== "revision_needed" && (
            <div className="flex gap-2">
              {selectedCard.stage !== "ideas" && selectedCard.stage !== "posted" && (
                <Button variant="outline" size="sm" onClick={() => setRevisionMode(true)} className="flex-1 h-9 rounded-lg border-red-200 text-red-600 hover:bg-red-50 dark:border-red-500/20 dark:text-red-400 bg-white dark:bg-transparent text-[12px] transition-all duration-150">
                  <ArrowRightLeft className="w-3.5 h-3.5 mr-1.5" />Revision
                </Button>
              )}
              {nextStage && nextColumn && selectedCard.stage !== "posted" && nextStage !== "posted" && (
                (["approved_scheduled", "posted"] as PipelineStage[]).includes(nextStage) && !userIsApprover ? (
                  <div className="flex-1 text-center py-1">
                    <p className="text-[11px] text-amber-600 dark:text-amber-400 font-medium">Approver permission required</p>
                  </div>
                ) : (
                  <Button size="sm" onClick={() => {
                    if (selectedCard.stage === "ideas" || nextStage === "awaiting_approval" || nextStage === "approved_scheduled") {
                      const missing: string[] = [];
                      if (!selectedCard.scheduledDate) missing.push("scheduled date");
                      if (!selectedCard.scheduledTime) missing.push("scheduled time");
                      if (!selectedCard.thumbnailUrl) missing.push("thumbnail");
                      if (!selectedCard.sourceVault?.rawFiles?.length) missing.push("content for publishing");
                      if (!selectedCard.caption?.trim()) missing.push("caption");
                      if (!selectedCard.assetSource?.trim()) missing.push("asset source");
                      const unchecked = checklist.filter((c) => !c.checked).length;
                      if (unchecked > 0) missing.push(`${unchecked} checklist item${unchecked > 1 ? "s" : ""}`);
                      if (missing.length > 0) {
                        setValidationErrors(missing);
                        return;
                      }
                    }
                    moveCard(selectedCard.id, nextStage);
                    addToast("Saving stage move...", "info");
                  }} className="flex-1 h-9 rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white text-[12px] shadow-sm transition-all duration-150">
                    Move to {nextColumn.title}<ChevronRight className="w-3.5 h-3.5 ml-1" />
                  </Button>
                )
              )}
            </div>
          )}
        </div>
      </div>

      {/* ─── Thumbnail Lightbox ─── */}
      {showLightbox && selectedCard.thumbnailUrl && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Image preview"
          onClick={(e) => { if (e.target === e.currentTarget) setShowLightbox(false); }}
          className="fixed inset-0 z-[60] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 sm:p-8"
        >
          <div className="relative max-w-4xl w-full max-h-[90dvh]">
            <RawImage
              src={selectedCard.thumbnailUrl}
              alt={selectedCard.title}
              className="max-w-full max-h-[85dvh] object-contain mx-auto rounded-lg shadow-2xl"
            />
            <button
              onClick={() => setShowLightbox(false)}
              aria-label="Close preview"
              className="absolute -top-3 -right-3 w-9 h-9 rounded-full bg-black/60 backdrop-blur-sm flex items-center justify-center text-white hover:bg-black/80 transition-colors cursor-pointer shadow-lg"
            >
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      )}

      {/* ─── Delete Confirmation Dialog ─── */}
      {pendingDelete && (
        <>
          <div onClick={() => setPendingDelete(false)} className="fixed inset-0 bg-black/40 dark:bg-black/60 z-[100] backdrop-blur-sm" />
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6" onClick={() => setPendingDelete(false)}>
            <div
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="delete-post-title"
              aria-describedby="delete-post-desc"
              className="w-full max-w-md sm:max-w-lg max-h-[75dvh] flex flex-col rounded-2xl overflow-hidden bg-white/85 dark:bg-[#18181b]/85 backdrop-blur-2xl border border-gray-200/60 dark:border-white/[0.12] shadow-[0_8px_32px_rgba(0,0,0,0.12)] dark:shadow-[0_8px_32px_rgba(0,0,0,0.5)]"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-200/40 dark:border-white/[0.08] shrink-0">
                <div className="w-9 h-9 rounded-xl bg-red-500/10 dark:bg-red-500/15 flex items-center justify-center shrink-0">
                  <Trash2 className="w-5 h-5 text-red-500" aria-hidden="true" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 id="delete-post-title" className="text-[15px] font-bold text-gray-900 dark:text-white">Delete this post?</h3>
                </div>
                <button onClick={() => setPendingDelete(false)} aria-label="Cancel delete" className="p-1.5 rounded-lg hover:bg-gray-100/80 dark:hover:bg-white/[0.06] text-gray-400 cursor-pointer transition-colors">
                  <X className="w-4 h-4" aria-hidden="true" />
                </button>
              </div>
              <div className="px-5 py-4">
                <p id="delete-post-desc" className="text-[13px] text-gray-700 dark:text-gray-300 leading-relaxed">
                  This permanently removes the card and its history. Cannot be undone.
                </p>
              </div>
              <div className="px-5 py-4 border-t border-gray-200/40 dark:border-white/[0.08] shrink-0 flex gap-2">
                <Button variant="outline" onClick={() => setPendingDelete(false)} className="flex-1 h-10 rounded-xl text-[13px] cursor-pointer">Cancel</Button>
                <Button onClick={() => { deleteCard(selectedCard.id); setPendingDelete(false); closeDrawer(); }} className="flex-1 h-10 rounded-xl bg-red-600 hover:bg-red-700 text-white text-[13px] font-medium cursor-pointer shadow-sm shadow-red-500/20">
                  Delete Post
                </Button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ─── Validation Error Modal ─── */}
      <ValidationErrorModal errors={validationErrors} onClose={() => setValidationErrors([])} />

      {/* ─── Media Library Picker ─── */}
      <MediaPicker
        open={!!showMediaPicker}
        onClose={() => setShowMediaPicker(null)}
        folder={showMediaPicker === "thumbnail" ? "thumbnails" : "raw-files"}
        cardId={selectedCard.id}
        onSelect={(result) => {
          if (showMediaPicker === "thumbnail") {
            updateCard(selectedCard.id, { thumbnailUrl: result.url });
            logAudit(selectedCard.id, currentUser.name, "asset_replaced", `Thumbnail: ${result.name}`);
            addToast("Thumbnail updated", "success");
          } else {
            const existingFiles = selectedCard.sourceVault?.rawFiles || [];
            const isFirstFile = existingFiles.length === 0;
            const newFile = {
              name: result.name,
              url: result.url,
              fileId: result.fileId,
              usageType: (isFirstFile ? "master" : "supplementary") as "master" | "supplementary",
              mimeType: result.mimeType,
              size: result.size,
              uploadedAt: new Date().toISOString(),
            };
            updateCard(selectedCard.id, { sourceVault: { ...(selectedCard.sourceVault || {}), rawFiles: [...existingFiles, newFile] } });
            logAudit(selectedCard.id, currentUser.name, "raw_file_uploaded", `Added ${result.name} (${newFile.usageType})`);
            addToast(`${result.name} added as content`, "success");
          }
          setShowMediaPicker(null);
        }}
      />
    </>
  );
}

// ─── Asset Source with "Other" conditional input ───
const PRESET_SOURCES = ["Canva Pro", "Envato Elements", "Pexels", "Shot by Team", "Client Provided", "Google Images", "AI Generated"];

function AssetSourceBlock({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const isOther = !!value && !PRESET_SOURCES.includes(value);

  return (
    <div className="p-4 border-b border-gray-100 dark:border-white/[0.04]">
      <label className="text-[9px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-[0.1em] flex items-center gap-1.5 mb-2.5">
        <FileText className="w-3 h-3 text-orange-400" />Asset Source
        {!value?.trim() && <span className="text-red-400 text-[8px] normal-case ml-auto">Required</span>}
      </label>
      <select
        value={isOther ? "__other__" : value}
        onChange={(e) => {
          if (e.target.value === "__other__") {
            onChange("");
          } else {
            onChange(e.target.value);
          }
        }}
        className="w-full h-9 px-3 rounded-lg bg-slate-50 dark:bg-white/[0.03] border border-gray-200 dark:border-white/[0.08] text-[12px] text-gray-700 dark:text-gray-300 outline-none cursor-pointer focus:border-orange-400 focus:ring-2 focus:ring-orange-100 dark:focus:ring-orange-500/10 transition-all"
      >
        <option value="">Select source...</option>
        {PRESET_SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
        <option value="__other__">Other (specify below)</option>
      </select>

      {isOther && (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Specify the asset source..."
          className="w-full h-9 px-3 mt-2 rounded-lg bg-slate-50 dark:bg-white/[0.03] border border-orange-200 dark:border-orange-500/20 text-[12px] text-gray-700 dark:text-gray-300 placeholder:text-gray-400 dark:placeholder:text-gray-600 outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100 dark:focus:ring-orange-500/10 transition-all"
          autoFocus
        />
      )}

      {!value?.trim() && (
        <p className="text-[9px] text-amber-500/80 mt-1.5 flex items-center gap-1"><AlertCircle className="w-2.5 h-2.5" />Fill before submitting for approval</p>
      )}
    </div>
  );
}
