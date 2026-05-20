"use client";

import { useState, useEffect, useRef } from "react";
import { usePipeline } from "@/lib/pipeline-context";
import { useToast } from "@/lib/toast-context";
import { Button } from "@/components/ui/button";
import { X, Send, FileCheck, AlertCircle } from "lucide-react";
import { MentionTextarea } from "./mention-textarea";
import { useFocusTrap } from "./use-focus-trap";

export function RevisionModal() {
  const { pendingReapproval, submitReapproval, cancelReapproval } = usePipeline();
  const { addToast } = useToast();
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  const open = !!pendingReapproval;
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") cancelReapproval(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, cancelReapproval]);

  useFocusTrap(dialogRef, open);

  if (!pendingReapproval) return null;

  const isValid = note.trim().length >= 10;
  const charCount = note.trim().length;

  const handleSubmit = () => {
    if (!isValid || submitting) return;
    setSubmitting(true);
    submitReapproval(pendingReapproval.cardId, note.trim());
    addToast("Revision submitted. Sent for re-approval.", "success");
    setNote("");
    setSubmitting(false);
  };

  const handleCancel = () => {
    cancelReapproval();
    setNote("");
  };

  return (
    <>
      {/* Backdrop */}
      <div onClick={handleCancel} className="fixed inset-0 bg-black/40 dark:bg-black/60 backdrop-blur-[2px] z-[60]" />

      {/* Modal */}
      <div className="fixed inset-0 flex items-center justify-center z-[60] p-4">
        <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="revision-modal-title" className="bg-white dark:bg-[#151518] rounded-2xl border border-gray-200 dark:border-white/[0.08] shadow-2xl w-full max-w-[480px] overflow-hidden">
          {/* Header */}
          <div className="relative px-6 pt-6 pb-4">
            <div className="absolute top-4 right-4">
              <button onClick={handleCancel} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-white/[0.06] text-gray-400 cursor-pointer transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-xl bg-violet-50 dark:bg-violet-500/10 flex items-center justify-center">
                <FileCheck className="w-5 h-5 text-violet-600 dark:text-violet-400" />
              </div>
              <div>
                <h2 id="revision-modal-title" className="text-[16px] font-bold text-gray-900 dark:text-white">Submit for Re-Approval</h2>
                <p className="text-[12px] text-gray-400 mt-0.5">This post will be sent back to the reviewer for review.</p>
              </div>
            </div>

            {/* Post being moved */}
            <div className="bg-gray-50 dark:bg-white/[0.03] rounded-xl border border-gray-100 dark:border-white/[0.06] px-4 py-3 flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-violet-500 shrink-0" />
              <p className="text-[13px] font-medium text-gray-700 dark:text-gray-300 truncate">{pendingReapproval.cardTitle}</p>
              <span className="ml-auto text-[10px] text-gray-400 shrink-0">Revision Needed → Awaiting Approval</span>
            </div>
          </div>

          {/* Body */}
          <div className="px-6 pb-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-[11px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-[0.06em] flex items-center gap-1.5">
                  <AlertCircle className="w-3 h-3 text-amber-500" />
                  What did you change? <span className="text-red-400">*</span>
                </label>
                <span className={`text-[10px] tabular-nums ${isValid ? "text-emerald-500" : "text-gray-400"}`}>
                  {charCount}/10 min
                </span>
              </div>
              <MentionTextarea
                value={note}
                onChange={setNote}
                placeholder="Detail what was fixed... Type @ to mention someone..."
                className="w-full min-h-[100px] bg-gray-50 dark:bg-white/[0.03] border border-gray-200 dark:border-white/[0.08] rounded-xl px-4 py-3 text-[13px] text-gray-800 dark:text-gray-200 placeholder:text-gray-400 outline-none focus:ring-2 focus:ring-violet-200 dark:focus:ring-violet-500/20 focus:border-violet-300 dark:focus:border-violet-500/30 resize-none transition-all duration-200"
                rows={4}
              />
              {charCount > 0 && charCount < 10 && (
                <p className="text-[10px] text-amber-500 flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" />
                  Please provide at least 10 characters describing your changes.
                </p>
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
              disabled={!isValid || submitting}
              className="flex-1 h-10 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-[13px] font-medium shadow-sm shadow-violet-500/20 disabled:opacity-40 disabled:shadow-none cursor-pointer transition-all duration-200"
            >
              <Send className="w-3.5 h-3.5 mr-1.5" />
              {submitting ? "Submitting..." : "Submit Revision"}
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
