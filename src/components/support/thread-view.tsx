"use client";

// Conversation view: message history + composer. Shared by the user-facing
// widget (viewerRole "user") and the admin Support Inbox (viewerRole "admin").

import { useState, useRef, useEffect } from "react";
import { ArrowLeft, Send } from "lucide-react";
import type { SupportThread, SupportMessage, SupportThreadStatus } from "@/lib/support/types";
import { threadShortCode, SUPPORT_STATUS_LABEL, SUPPORT_MAX_BODY } from "@/lib/support/format";
import { AttachmentBar } from "./attachment-bar";

const STATUS_STYLE: Record<SupportThreadStatus, string> = {
  open: "bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300",
  in_progress: "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
  resolved: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  closed: "bg-gray-100 text-gray-500 dark:bg-white/[0.06] dark:text-gray-400",
};

function timeLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return sameDay ? time : `${d.toLocaleDateString([], { month: "short", day: "numeric" })}, ${time}`;
}

interface ThreadViewProps {
  thread: SupportThread;
  messages: SupportMessage[];
  viewerRole: "user" | "admin";
  onSend: (body: string, files: File[]) => Promise<void>;
  onBack?: () => void;
  onError?: (message: string) => void;
  headerExtra?: React.ReactNode;
}

export function ThreadView({
  thread,
  messages,
  viewerRole,
  onSend,
  onBack,
  onError,
  headerExtra,
}: ThreadViewProps) {
  const [body, setBody] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  async function handleSend() {
    const trimmed = body.trim();
    if ((trimmed.length === 0 && files.length === 0) || sending) return;
    setSending(true);
    try {
      await onSend(trimmed, files);
      setBody("");
      setFiles([]);
    } catch (err) {
      onError?.(err instanceof Error ? err.message : "Could not send your message.");
    } finally {
      setSending(false);
    }
  }

  const canSend = (body.trim().length > 0 || files.length > 0) && !sending;

  return (
    <div className="flex h-full flex-col">
      {/* Sub-header */}
      <div className="flex items-center gap-2 border-b border-gray-100 px-3 py-2.5 dark:border-white/[0.06]">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            aria-label="Back"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-white/[0.06]"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold text-gray-900 dark:text-white">
            {thread.subject || `Ticket #${threadShortCode(thread.id)}`}
          </p>
          <p className="text-[11px] text-gray-400">
            {thread.kind === "chat" ? "Live chat" : `Ticket #${threadShortCode(thread.id)}`}
          </p>
        </div>
        <span
          className={`shrink-0 rounded-md px-2 py-0.5 text-[10px] font-semibold ${STATUS_STYLE[thread.status]}`}
        >
          {SUPPORT_STATUS_LABEL[thread.status]}
        </span>
        {headerExtra}
      </div>

      {/* Messages */}
      <div className="flex-1 space-y-3 overflow-y-auto px-3 py-4">
        {messages.length === 0 && (
          <p className="py-8 text-center text-[12px] text-gray-400">No messages yet.</p>
        )}
        {messages.map((m) => {
          if (m.senderType === "system") {
            return (
              <p key={m.id} className="text-center text-[11px] text-gray-400">
                {m.body}
              </p>
            );
          }
          const self = viewerRole === "user" ? m.senderType === "user" : m.senderType === "admin";
          return (
            <div key={m.id} className={`flex flex-col ${self ? "items-end" : "items-start"}`}>
              {!self && (
                <span className="mb-0.5 px-1 text-[10px] font-medium text-gray-400">
                  {m.senderName}
                </span>
              )}
              <div
                className={`max-w-[85%] rounded-2xl px-3 py-2 text-[13px] leading-relaxed ${
                  self
                    ? "rounded-br-md bg-orange-500 text-white"
                    : "rounded-bl-md bg-gray-100 text-gray-800 dark:bg-white/[0.07] dark:text-gray-100"
                }`}
              >
                {m.body && <p className="whitespace-pre-wrap break-words">{m.body}</p>}
                {m.attachments.length > 0 && (
                  <div className={`flex flex-col gap-2 ${m.body ? "mt-2" : ""}`}>
                    {m.attachments.map((a, i) =>
                      a.kind === "image" ? (
                        <a
                          key={`${a.storageKey}-${i}`}
                          href={a.signedUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={a.signedUrl}
                            alt={a.name}
                            className="max-h-44 rounded-lg border border-black/5"
                          />
                        </a>
                      ) : (
                        <video
                          key={`${a.storageKey}-${i}`}
                          src={a.signedUrl}
                          controls
                          preload="metadata"
                          className="max-h-52 w-full rounded-lg bg-black"
                        />
                      ),
                    )}
                  </div>
                )}
              </div>
              <span className="mt-0.5 px-1 text-[10px] text-gray-400">{timeLabel(m.createdAt)}</span>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>

      {/* Composer */}
      <div className="border-t border-gray-100 p-3 dark:border-white/[0.06]">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void handleSend();
            }
          }}
          maxLength={SUPPORT_MAX_BODY}
          rows={2}
          aria-label="Message"
          placeholder="Type your message…"
          className="w-full resize-none rounded-lg border border-gray-200 bg-white px-3 py-2 text-[13px] text-gray-900 outline-none placeholder:text-gray-400 focus:border-orange-400 dark:border-white/10 dark:bg-white/[0.03] dark:text-white"
        />
        <div className="mt-2 flex items-end justify-between gap-2">
          <AttachmentBar files={files} onChange={setFiles} onError={onError} disabled={sending} />
          <button
            type="button"
            onClick={handleSend}
            disabled={!canSend}
            className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-lg bg-orange-500 px-4 text-[13px] font-semibold text-white transition-colors hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Send className="h-3.5 w-3.5" />
            {sending ? "Sending…" : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
}
