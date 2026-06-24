"use client";

import { RawImage } from "@/components/raw-image";
import { useState, useRef, useEffect } from "react";
import { usePipeline } from "@/lib/pipeline-context";
import { useToast } from "@/lib/toast-context";
import { supabase } from "@/lib/supabaseClient";
import { withStorageControlTimeout, withStorageUploadTimeout } from "@/lib/storage-upload-timeout";
import { Button } from "@/components/ui/button";
import { X, AlertTriangle, Send, Paperclip, Image as ImageIcon, Trash2 } from "lucide-react";
import { MentionTextarea } from "./mention-textarea";
import { useFocusTrap } from "./use-focus-trap";

const useSupabase = !!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
const PRIVATE_ATTACHMENT_BUCKET = "support-attachments";

async function revisionAttachmentUrl(file: File, workspaceId?: string): Promise<string> {
  const { data: { session } } = await withStorageControlTimeout(
    supabase.auth.getSession(),
    "Revision attachment session check",
  );
  if (!session?.access_token) {
    throw new Error("Please sign in again before attaching a revision file.");
  }

  const uploadTargetRes = await withStorageControlTimeout(
    fetch("/api/support/uploads", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
        ...(workspaceId ? { "X-Workspace-Id": workspaceId } : {}),
      },
      body: JSON.stringify({ files: [{ name: file.name, mime: file.type, size: file.size }] }),
    }),
    "Revision attachment upload target",
  );
  const payload = await uploadTargetRes.json().catch(() => ({})) as {
    error?: unknown;
    uploads?: Array<{ storageKey?: string; token?: string; name?: string }>;
  };
  if (!uploadTargetRes.ok) {
    throw new Error(typeof payload.error === "string" ? payload.error : "Could not prepare attachment upload.");
  }
  const target = payload.uploads?.[0];
  if (!target?.storageKey || !target.token) {
    throw new Error("Could not prepare attachment upload.");
  }

  const { error } = await withStorageUploadTimeout(
    supabase.storage.from(PRIVATE_ATTACHMENT_BUCKET).uploadToSignedUrl(target.storageKey, target.token, file),
    file.size,
    "Revision attachment upload",
  );
  if (error) {
    throw new Error(`Could not upload attachment: ${error.message}`);
  }

  const params = new URLSearchParams({ key: target.storageKey });
  if (target.name) params.set("name", target.name);
  return `/api/support/attachment?${params.toString()}`;
}

export function KickbackModal() {
  const { pendingKickback, submitKickback, cancelKickback, workspaceId } = usePipeline();
  const { addToast } = useToast();
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [filePreview, setFilePreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  const open = !!pendingKickback;
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") cancelKickback(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, cancelKickback]);

  useFocusTrap(dialogRef, open);

  if (!pendingKickback) return null;

  const isValid = note.trim().length >= 10;
  const charCount = note.trim().length;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    setFilePreview(URL.createObjectURL(f));
  };

  const removeFile = () => {
    setFile(null);
    if (filePreview) URL.revokeObjectURL(filePreview);
    setFilePreview(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleSubmit = async () => {
    if (!isValid) return;
    setUploading(true);
    try {
      let attachmentUrl: string | undefined;

      if (file && useSupabase) {
        attachmentUrl = await revisionAttachmentUrl(file, workspaceId);
      } else if (file) {
        attachmentUrl = filePreview || undefined;
      }

      submitKickback(pendingKickback.cardId, note.trim(), attachmentUrl);
      setNote("");
      removeFile();
    } catch {
      // A thrown/hung auth or storage call must never strand the "Sending…"
      // button. Surface it; the finally re-enables the form so the user retries.
      addToast("Couldn't send the revision. Check your connection and try again.", "error");
    } finally {
      setUploading(false);
    }
  };

  const handleCancel = () => {
    cancelKickback();
    setNote("");
    removeFile();
  };

  return (
    <>
      {/* Backdrop */}
      <div onClick={handleCancel} className="fixed inset-0 bg-black/40 dark:bg-black/60 backdrop-blur-[2px] z-[60]" />

      {/* Modal */}
      <div className="fixed inset-0 flex items-center justify-center z-[60] p-4">
        <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="kickback-modal-title" className="bg-white dark:bg-[#151518] rounded-2xl border border-gray-200 dark:border-white/[0.08] shadow-2xl w-full max-w-[480px] overflow-hidden">
          {/* Header */}
          <div className="relative px-6 pt-6 pb-4">
            <div className="absolute top-4 right-4">
              <button onClick={handleCancel} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-white/[0.06] text-gray-400 cursor-pointer transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-xl bg-red-50 dark:bg-red-500/10 flex items-center justify-center">
                <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400" />
              </div>
              <div>
                <h2 id="kickback-modal-title" className="text-[16px] font-bold text-gray-900 dark:text-white">Request Revision</h2>
                <p className="text-[12px] text-gray-400 mt-0.5">Send this post back for fixes with your feedback.</p>
              </div>
            </div>

            {/* Post being kicked back */}
            <div className="bg-red-50/50 dark:bg-red-500/[0.03] rounded-xl border border-red-100 dark:border-red-500/10 px-4 py-3 flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-red-500 shrink-0" />
              <p className="text-[13px] font-medium text-gray-700 dark:text-gray-300 truncate">{pendingKickback.cardTitle}</p>
              <span className="ml-auto text-[10px] text-gray-400 shrink-0">Awaiting Approval → Revision Needed</span>
            </div>
          </div>

          {/* Body */}
          <div className="px-6 pb-4 space-y-4">
            {/* Note field */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-[11px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-[0.06em] flex items-center gap-1.5">
                  <AlertTriangle className="w-3 h-3 text-red-500" />
                  What needs to be fixed? <span className="text-red-400">*</span>
                </label>
                <span className={`text-[10px] tabular-nums ${isValid ? "text-emerald-500" : "text-gray-400"}`}>
                  {charCount}/10 min
                </span>
              </div>
              <MentionTextarea
                value={note}
                onChange={setNote}
                placeholder="Be specific: What's wrong? Type @ to mention someone..."
                className="w-full min-h-[100px] bg-gray-50 dark:bg-white/[0.03] border border-gray-200 dark:border-white/[0.08] rounded-xl px-4 py-3 text-[13px] text-gray-800 dark:text-gray-200 placeholder:text-gray-400 outline-none focus:ring-2 focus:ring-red-200 dark:focus:ring-red-500/20 focus:border-red-300 dark:focus:border-red-500/30 resize-none transition-all duration-200"
                rows={4}
              />
              {charCount > 0 && charCount < 10 && (
                <p className="text-[10px] text-amber-500 flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" />
                  Please provide at least 10 characters describing what needs fixing.
                </p>
              )}
            </div>

            {/* File attachment */}
            <div>
              <label className="text-[11px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-[0.06em] flex items-center gap-1.5 mb-2">
                <Paperclip className="w-3 h-3 text-gray-400" />
                Attach screenshot/reference <span className="text-[9px] font-normal normal-case text-gray-400">(Optional)</span>
              </label>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleFileChange}
                className="hidden"
              />
              {!file ? (
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full border-2 border-dashed border-gray-200 dark:border-white/[0.08] rounded-xl py-4 flex flex-col items-center gap-1.5 text-gray-400 hover:text-gray-500 hover:border-gray-300 dark:hover:border-white/[0.15] transition-colors cursor-pointer"
                >
                  <ImageIcon className="w-5 h-5" />
                  <span className="text-[11px]">Click to attach an image</span>
                </button>
              ) : (
                <div className="relative bg-gray-50 dark:bg-white/[0.03] rounded-xl border border-gray-200 dark:border-white/[0.08] p-3 flex items-center gap-3">
                  {filePreview && <RawImage src={filePreview} alt="" className="w-14 h-14 rounded-lg object-cover shrink-0" />}
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] font-medium text-gray-700 dark:text-gray-300 truncate">{file.name}</p>
                    <p className="text-[10px] text-gray-400 mt-0.5">{(file.size / 1024).toFixed(0)} KB</p>
                  </div>
                  <button onClick={removeFile} className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-500/10 text-gray-400 hover:text-red-500 transition-colors cursor-pointer">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Footer */}
          <div className="px-6 pb-6 flex gap-2">
            <Button variant="outline" onClick={handleCancel} className="flex-1 h-10 rounded-xl text-[13px] cursor-pointer">
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={!isValid || uploading}
              className="flex-1 h-10 rounded-xl bg-red-600 hover:bg-red-700 text-white text-[13px] font-medium shadow-sm shadow-red-500/20 disabled:opacity-40 disabled:shadow-none cursor-pointer transition-all duration-200"
            >
              <Send className="w-3.5 h-3.5 mr-1.5" />
              {uploading ? "Sending..." : "Request Revision"}
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
