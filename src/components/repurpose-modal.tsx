"use client";

import { CardThumbnailMedia } from "@/components/card-thumbnail-media";
import { useState, useEffect, useRef } from "react";
import { ContentCard, Platform, ALL_PLATFORMS, ContentType } from "@/lib/types";
import { usePipeline } from "@/lib/pipeline-context";
import { useToast } from "@/lib/toast-context";
import { PlatformIcon } from "./platform-icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { X, RotateCcw, Sparkles, Copy, Calendar, ArrowRight, CheckCircle } from "lucide-react";
import { ensureMediaAsset } from "@/lib/media-assets";
import { useAuth } from "@/lib/auth-context";
import { useFocusTrap } from "./use-focus-trap";
import { isDrivePublishableMediaMime } from "@/lib/drive-policy";
import { resolvePostedArchiveDate } from "@/lib/post-archive";

type RepurposeMode = "select" | "repost" | "rewrite" | "seasonal";

interface Props {
  card: ContentCard;
  onClose: () => void;
}

export function RepurposeModal({ card, onClose }: Props) {
  const { createCard, workspaceId } = usePipeline();
  const { addToast } = useToast();
  const { currentUser } = useAuth();
  const [mode, setMode] = useState<RepurposeMode>("select");
  const [title, setTitle] = useState(card.title);
  const [caption, setCaption] = useState(card.caption || "");
  const [hook, setHook] = useState(card.hook || "");
  const [platforms, setPlatforms] = useState<Platform[]>(card.platforms);
  const [contentType] = useState<ContentType>(card.contentType);
  const [scheduledDate, setScheduledDate] = useState("");
  const [scheduledTime, setScheduledTime] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const selectDialogRef = useRef<HTMLDivElement>(null);
  const configDialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Trap focus in whichever step is currently shown.
  useFocusTrap(selectDialogRef, mode === "select");
  useFocusTrap(configDialogRef, mode !== "select");

  const togglePlatform = (p: Platform) => {
    setPlatforms((prev) => prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]);
  };

  const handleSubmit = () => {
    if (!title.trim() || platforms.length === 0 || !scheduledDate || !scheduledTime || submitting) return;
    setSubmitting(true);
    createCard({
      title: mode === "repost" ? `[Repost] ${card.title}` : `[Repurposed] ${title.trim()}`,
      stage: "ideas",
      platforms,
      contentType,
      thumbnailUrl: card.thumbnailUrl,
      caption: caption.trim() || undefined,
      hook: hook.trim() || undefined,
      scheduledDate,
      scheduledTime,
      sourceVault: card.sourceVault
        ? {
            designLink: card.sourceVault.designLink,
            driveFolder: card.sourceVault.driveFolder,
            rawFiles: card.sourceVault.rawFiles?.map((file) => ({ ...file })),
          }
        : undefined,
      assetSource: card.assetSource,
      licenseFileId: card.licenseFileId,
    });
    // Sync thumbnail and rawFiles to Media Library (dedup-safe)
    if (card.thumbnailUrl) {
      ensureMediaAsset({
        name: card.title || "Repurposed asset",
        url: card.thumbnailUrl,
        fileType: card.contentType === "video" || card.contentType === "reel" ? "video" : "image",
        folder: "Content Engine Uploads",
        addedBy: currentUser.name,
        workspaceId,
      }).catch((err) => console.error("[repurpose] media_assets sync failed:", err));
    }
    if (card.sourceVault?.rawFiles) {
      for (const rf of card.sourceVault.rawFiles) {
        if (!isDrivePublishableMediaMime(rf.mimeType, rf.name)) continue;
        ensureMediaAsset({
          name: rf.name,
          url: rf.playbackUrl || rf.driveProxyUrl || rf.url,
          fileType: rf.mimeType?.startsWith("video") ? "video" : "image",
          folder: "Content Engine Uploads",
          addedBy: currentUser.name,
          workspaceId,
        }).catch((err) => console.error("[repurpose] media_assets sync failed:", err));
      }
    }
    addToast(`Content repurposed and added to Ideas.`, "success");
    setSubmitting(false);
    onClose();
  };

  // Step 1: Choose repurpose type
  if (mode === "select") {
    return (
      <>
        <div onClick={onClose} className="fixed inset-0 bg-black/30 dark:bg-black/60 z-50" />
        <div className="fixed inset-0 flex items-center justify-center z-50 p-4">
          <div ref={selectDialogRef} role="dialog" aria-modal="true" aria-labelledby="repurpose-select-title" className="bg-white dark:bg-[#151518] rounded-2xl border border-gray-200 dark:border-white/[0.08] shadow-2xl w-full max-w-[480px]">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-white/[0.06]">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-blue-50 dark:bg-blue-500/10 flex items-center justify-center"><RotateCcw className="w-4 h-4 text-blue-600 dark:text-blue-400" /></div>
                <div>
                  <h2 id="repurpose-select-title" className="text-[15px] font-semibold text-gray-900 dark:text-white">Repurpose Content</h2>
                  <p className="text-[11px] text-gray-400 mt-0.5">Give this post a second life</p>
                </div>
              </div>
              <button onClick={onClose} className="p-1.5 rounded-md hover:bg-gray-100 dark:hover:bg-white/[0.06] text-gray-400 cursor-pointer"><X className="w-4 h-4" /></button>
            </div>

            {/* Original post preview */}
            <div className="px-5 pt-4 pb-3">
              <div className="flex gap-3 p-3 rounded-xl bg-gray-50 dark:bg-white/[0.03] border border-gray-100 dark:border-white/[0.06]">
                <CardThumbnailMedia card={card} className="w-16 h-16 rounded-lg object-cover shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-medium text-gray-800 dark:text-gray-200 line-clamp-1">{card.title}</p>
                  <div className="flex items-center gap-1.5 mt-1">
                    {card.platforms.map((p) => <span key={p} className="text-gray-400"><PlatformIcon platform={p} className="w-3 h-3" /></span>)}
                    <span className="text-[10px] text-gray-400 ml-1">Posted {resolvePostedArchiveDate(card) || "unknown"}</span>
                  </div>
                  <p className="text-[11px] text-gray-500 mt-1 line-clamp-2">{card.caption}</p>
                </div>
              </div>
            </div>

            {/* Repurpose options */}
            <div className="px-5 pb-5 space-y-2">
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-[0.08em] mb-2">How would you like to repurpose?</p>

              <button onClick={() => setMode("repost")} className="w-full flex items-center gap-3 p-3.5 rounded-xl border border-gray-200 dark:border-white/[0.08] hover:border-blue-300 dark:hover:border-blue-500/30 hover:bg-blue-50/50 dark:hover:bg-blue-500/5 transition-all duration-200 cursor-pointer text-left group">
                <div className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-500/10 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform"><Copy className="w-5 h-5 text-emerald-600 dark:text-emerald-400" /></div>
                <div>
                  <p className="text-[13px] font-semibold text-gray-800 dark:text-gray-200">Repost As-Is</p>
                  <p className="text-[11px] text-gray-400 mt-0.5">Same content, new schedule. Perfect for evergreen posts.</p>
                </div>
                <ArrowRight className="w-4 h-4 text-gray-300 ml-auto shrink-0 group-hover:text-blue-500 transition-colors" />
              </button>

              <button onClick={() => setMode("rewrite")} className="w-full flex items-center gap-3 p-3.5 rounded-xl border border-gray-200 dark:border-white/[0.08] hover:border-blue-300 dark:hover:border-blue-500/30 hover:bg-blue-50/50 dark:hover:bg-blue-500/5 transition-all duration-200 cursor-pointer text-left group">
                <div className="w-10 h-10 rounded-xl bg-violet-50 dark:bg-violet-500/10 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform"><Sparkles className="w-5 h-5 text-violet-600 dark:text-violet-400" /></div>
                <div>
                  <p className="text-[13px] font-semibold text-gray-800 dark:text-gray-200">Rewrite for New Platform</p>
                  <p className="text-[11px] text-gray-400 mt-0.5">Adapt the message for a different audience or platform.</p>
                </div>
                <ArrowRight className="w-4 h-4 text-gray-300 ml-auto shrink-0 group-hover:text-blue-500 transition-colors" />
              </button>

              <button onClick={() => { setMode("seasonal"); setTitle(`${card.title} — Updated`); }} className="w-full flex items-center gap-3 p-3.5 rounded-xl border border-gray-200 dark:border-white/[0.08] hover:border-blue-300 dark:hover:border-blue-500/30 hover:bg-blue-50/50 dark:hover:bg-blue-500/5 transition-all duration-200 cursor-pointer text-left group">
                <div className="w-10 h-10 rounded-xl bg-amber-50 dark:bg-amber-500/10 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform"><Calendar className="w-5 h-5 text-amber-600 dark:text-amber-400" /></div>
                <div>
                  <p className="text-[13px] font-semibold text-gray-800 dark:text-gray-200">Update for Current Season</p>
                  <p className="text-[11px] text-gray-400 mt-0.5">Refresh the copy with seasonal messaging and new dates.</p>
                </div>
                <ArrowRight className="w-4 h-4 text-gray-300 ml-auto shrink-0 group-hover:text-blue-500 transition-colors" />
              </button>
            </div>
          </div>
        </div>
      </>
    );
  }

  // Step 2: Configure the repurposed post
  return (
    <>
      <div onClick={onClose} className="fixed inset-0 bg-black/30 dark:bg-black/60 z-50" />
      <div className="fixed inset-0 flex items-center justify-center z-50 p-4">
        <div ref={configDialogRef} role="dialog" aria-modal="true" aria-labelledby="repurpose-config-title" className="bg-white dark:bg-[#151518] rounded-2xl border border-gray-200 dark:border-white/[0.08] shadow-2xl w-full max-w-[520px] max-h-[85dvh] flex flex-col">
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-white/[0.06] shrink-0">
            <div className="flex items-center gap-2">
              <button onClick={() => setMode("select")} className="p-1 rounded-md hover:bg-gray-100 dark:hover:bg-white/[0.06] text-gray-400 cursor-pointer"><ArrowRight className="w-4 h-4 rotate-180" /></button>
              <h2 id="repurpose-config-title" className="text-[15px] font-semibold text-gray-900 dark:text-white">
                {mode === "repost" ? "Repost As-Is" : mode === "rewrite" ? "Rewrite for New Platform" : "Update for Season"}
              </h2>
            </div>
            <button onClick={onClose} className="p-1.5 rounded-md hover:bg-gray-100 dark:hover:bg-white/[0.06] text-gray-400 cursor-pointer"><X className="w-4 h-4" /></button>
          </div>

          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            {/* Title — editable for rewrite/seasonal, readonly for repost */}
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-[0.08em]">Title</label>
              {mode === "repost" ? (
                <p className="text-[13px] font-medium text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-white/[0.03] rounded-lg px-3 py-2 border border-gray-100 dark:border-white/[0.06]">{card.title}</p>
              ) : (
                <Input value={title} onChange={(e) => setTitle(e.target.value)} className="h-9 bg-gray-50 dark:bg-white/[0.04] border-gray-200 dark:border-white/[0.08] rounded-lg text-[13px]" />
              )}
            </div>

            {/* Platforms */}
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-[0.08em]">
                {mode === "rewrite" ? "New Target Platforms" : "Platforms"}
              </label>
              <div className="flex flex-wrap gap-1.5">
                {ALL_PLATFORMS.map((p) => (
                  <button key={p.id} type="button" onClick={() => togglePlatform(p.id)}
                    className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium border transition-all duration-200 cursor-pointer ${
                      platforms.includes(p.id)
                        ? "bg-blue-50 border-blue-200 text-blue-700 dark:bg-blue-500/10 dark:border-blue-500/30 dark:text-blue-400"
                        : "bg-white border-gray-200 text-gray-500 hover:bg-gray-50 dark:bg-transparent dark:border-white/[0.08] dark:text-gray-400"
                    }`}>
                    <PlatformIcon platform={p.id} className="w-3.5 h-3.5" />{p.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Caption — editable for rewrite/seasonal */}
            {mode !== "repost" && (
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-[0.08em]">
                  {mode === "seasonal" ? "Updated Caption" : "Rewritten Caption"}
                </label>
                <Textarea value={caption} onChange={(e) => setCaption(e.target.value)} className="min-h-[70px] bg-gray-50 dark:bg-white/[0.04] border-gray-200 dark:border-white/[0.08] rounded-lg text-[12px] text-gray-800 dark:text-gray-200 resize-none" />
              </div>
            )}

            {/* Hook */}
            {mode !== "repost" && (
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-[0.08em]">Hook</label>
                <Input value={hook} onChange={(e) => setHook(e.target.value)} className="h-9 bg-gray-50 dark:bg-white/[0.04] border-gray-200 dark:border-white/[0.08] rounded-lg text-[12px] text-gray-800 dark:text-gray-200" />
              </div>
            )}

            {/* Schedule — always required */}
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-[0.08em]">New Schedule <span className="text-red-400">*</span></label>
              <div className="flex gap-2">
                <Input type="date" value={scheduledDate} onChange={(e) => setScheduledDate(e.target.value)} min={new Date().toISOString().slice(0, 10)} className="h-9 flex-1 bg-gray-50 dark:bg-white/[0.04] border-gray-200 dark:border-white/[0.08] rounded-lg text-[12px] text-gray-800 dark:text-gray-200" />
                <Input type="time" value={scheduledTime} onChange={(e) => setScheduledTime(e.target.value)} className="h-9 w-[120px] sm:w-28 bg-gray-50 dark:bg-white/[0.04] border-gray-200 dark:border-white/[0.08] rounded-lg text-[12px] text-gray-800 dark:text-gray-200" />
              </div>
              <p className="text-[10px] text-gray-400">All times shown in Central Time (CST).</p>
              {(!scheduledDate || !scheduledTime) && <p className="text-[10px] text-amber-500">Select when this should be published</p>}
            </div>
          </div>

          {/* Actions */}
          <div className="p-4 border-t border-gray-100 dark:border-white/[0.06] shrink-0">
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setMode("select")} className="flex-1 h-10 rounded-lg text-[12px]">Back</Button>
              <Button
                onClick={handleSubmit}
                disabled={platforms.length === 0 || !scheduledDate || !scheduledTime || submitting}
                className="reach-secondary-action flex-1 h-10 rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white text-[12px] shadow-sm disabled:opacity-40"
              >
                <CheckCircle className="w-3.5 h-3.5 mr-1.5" />
                {mode === "repost" ? "Schedule Repost" : "Send to The Reach"}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
