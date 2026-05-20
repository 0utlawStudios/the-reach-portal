"use client";

// The "Report an issue" form: issue type, description, optional attachments.
// Success is shown by the parent widget once onSubmit resolves.

import { useState, useRef, useCallback } from "react";
import {
  SUPPORT_ISSUE_CATEGORIES,
  SUPPORT_MIN_BODY,
  SUPPORT_MAX_BODY,
  spliceAtSelection,
} from "@/lib/support/format";
import { AttachmentBar } from "./attachment-bar";
import { EmojiPicker } from "./emoji-picker";

interface TicketFormProps {
  onSubmit: (input: { body: string; category: string | null; files: File[] }) => Promise<void>;
  onError?: (message: string) => void;
}

export function TicketForm({ onSubmit, onError }: TicketFormProps) {
  const [category, setCategory] = useState<string | null>(null);
  const [body, setBody] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const insertEmoji = useCallback(
    (emoji: string) => {
      const el = textareaRef.current;
      const start = el?.selectionStart ?? body.length;
      const end = el?.selectionEnd ?? body.length;
      const { value, caret } = spliceAtSelection(body, start, end, emoji);
      if (value.length > SUPPORT_MAX_BODY) return;
      setBody(value);
      requestAnimationFrame(() => {
        const node = textareaRef.current;
        if (node) {
          node.focus();
          node.setSelectionRange(caret, caret);
        }
      });
    },
    [body],
  );

  const trimmed = body.trim();
  const canSubmit = trimmed.length >= SUPPORT_MIN_BODY && !submitting;

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await onSubmit({ body: trimmed, category, files });
      // On success the parent switches view and unmounts this form.
    } catch (err) {
      onError?.(err instanceof Error ? err.message : "Could not submit your ticket.");
      setSubmitting(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 min-h-0 space-y-5 overflow-y-auto p-4">
        <div>
          <p className="text-[13px] font-semibold text-gray-900 dark:text-white">
            What kind of issue? <span className="font-normal text-gray-400">(optional)</span>
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {SUPPORT_ISSUE_CATEGORIES.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setCategory((prev) => (prev === c.id ? null : c.id))}
                className={`h-9 rounded-lg border px-3 text-[12px] font-medium transition-colors ${
                  category === c.id
                    ? "border-orange-500 bg-orange-50 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300"
                    : "border-gray-200 text-gray-600 hover:border-gray-300 dark:border-white/10 dark:text-gray-300 dark:hover:border-white/20"
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label
            htmlFor="support-ticket-body"
            className="text-[13px] font-semibold text-gray-900 dark:text-white"
          >
            Describe the issue
          </label>
          <textarea
            id="support-ticket-body"
            ref={textareaRef}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            maxLength={SUPPORT_MAX_BODY}
            rows={5}
            placeholder="Tell us what happened and what you expected to see…"
            className="mt-2 w-full resize-none rounded-lg border border-gray-200 bg-white px-3 py-2 text-[13px] text-gray-900 outline-none placeholder:text-gray-400 focus:border-orange-400 dark:border-white/10 dark:bg-white/[0.03] dark:text-white"
          />
          <div className="mt-1.5">
            <EmojiPicker onPick={insertEmoji} disabled={submitting} />
          </div>
        </div>

        <div>
          <p className="mb-2 text-[13px] font-semibold text-gray-900 dark:text-white">
            Add a screenshot or video <span className="font-normal text-gray-400">(optional)</span>
          </p>
          <AttachmentBar files={files} onChange={setFiles} onError={onError} disabled={submitting} />
        </div>
      </div>

      <div className="shrink-0 border-t border-gray-100 p-4 dark:border-white/[0.06]">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!canSubmit}
          className="h-11 w-full rounded-lg bg-orange-500 text-[13px] font-semibold text-white transition-colors hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {submitting ? "Sending…" : "Send ticket"}
        </button>
        <p className="mt-2 text-center text-[11px] text-gray-400">
          Our tech team replies within 24-48 hours.
        </p>
      </div>
    </div>
  );
}
