"use client";

import { RawImage } from "@/components/raw-image";
import { useState, useRef, useEffect } from "react";
import { usePipeline } from "@/lib/pipeline-context";
import { useToast } from "@/lib/toast-context";
import { supabase } from "@/lib/supabaseClient";
import { Button } from "@/components/ui/button";
import { X, AlertTriangle, Send, Paperclip, Image as ImageIcon, Trash2 } from "lucide-react";
import { MentionTextarea } from "./mention-textarea";

const useSupabase = !!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

export function KickbackModal() {
  const { pendingKickback, submitKickback, cancelKickback } = usePipeline();
  const { addToast } = useToast();
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [filePreview, setFilePreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const open = !!pendingKickback;
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") cancelKickback(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, cancelKickback]);

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

    let attachmentUrl: string | undefined;

    if (file && useSupabase) {
      const ext = file.name.split(".").pop();
      const path = `kickback/${pendingKickback.cardId}-${Date.now()}.${ext}`;
      const { error } = await supabase.storage.from("avatars").upload(path, file, { upsert: true });
      if (!error) {
        const { data: urlData } = supabase.storage.from("avatars").getPublicUrl(path);
        attachmentUrl = urlData.publicUrl;
      }
    } else if (file) {
      attachmentUrl = filePreview || undefined;
    }

    submitKickback(pendingKickback.cardId, note.trim(), attachmentUrl);
    addToast("Revision requested — creator and approvers notified.", "warning");
    setNote("");
    removeFile();
    setUploading(false);
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
        <div className="bg-white dark:bg-[#151518] rounded-2xl border border-gray-200 dark:border-white/[0.08] shadow-2xl w-full max-w-[480px] overflow-hidden">
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
                <h2 className="text-[16px] font-bold text-gray-900 dark:text-white">Request Revision</h2>
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
