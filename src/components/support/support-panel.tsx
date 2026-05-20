"use client";

// The Support Center panel — the heavy half of the floating widget. It is
// code-split out of support-widget.tsx (next/dynamic, ssr:false) so framer-
// motion, the ticket form and the conversation view load only when the widget
// is first opened. The useSupport hook instance is owned by the shell and
// passed in, so the trigger's unread dot and the panel read one data source.

import { useState, useEffect, useRef, useCallback } from "react";
import { motion } from "framer-motion";
import { LifeBuoy, X, Plus, ChevronRight, CheckCircle2 } from "lucide-react";
import { useToast } from "@/lib/toast-context";
import type { UseSupport } from "@/lib/support/use-support";
import { threadShortCode, SUPPORT_STATUS_LABEL } from "@/lib/support/format";
import { TicketForm } from "./ticket-form";
import { ThreadView } from "./thread-view";

type View = "home" | "form" | "thread" | "sent";
type Tab = "tickets" | "chat";

export interface SupportPanelProps {
  support: UseSupport;
  /** When set, open straight to this thread (arrived via a ?support= link). */
  initialThreadId: string | null;
  onClose: () => void;
}

export function SupportPanel({ support, initialThreadId, onClose }: SupportPanelProps) {
  const { addToast } = useToast();
  const [tab, setTab] = useState<Tab>("tickets");
  const [view, setView] = useState<View>("home");
  const [sentThreadId, setSentThreadId] = useState<string | null>(null);
  const deepLinkHandled = useRef(false);

  const {
    openThread,
    markRead,
    closeThread,
    sendMessage,
    createTicket,
    loadChat,
    sendChatMessage,
    refresh,
  } = support;

  const goThread = useCallback(
    async (threadId: string) => {
      try {
        await openThread(threadId);
        setTab("tickets");
        setView("thread");
        void markRead(threadId);
      } catch {
        addToast("Could not open that conversation.", "error");
      }
    },
    [openThread, markRead, addToast],
  );

  // The panel mounts on open, so this refreshes the thread list every time the
  // widget is opened — page-load data fetching is deferred to browser idle.
  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Deep link: open straight to the thread the shell captured from ?support=.
  // goThread is a local useCallback that setStates; deferring it into a
  // microtask callback keeps react-hooks/set-state-in-effect satisfied.
  useEffect(() => {
    if (deepLinkHandled.current || !initialThreadId) return;
    deepLinkHandled.current = true;
    void Promise.resolve().then(() => goThread(initialThreadId));
  }, [initialThreadId, goThread]);

  function backToHome() {
    closeThread();
    setView("home");
  }
  function openChatTab() {
    setTab("chat");
    void loadChat().catch(() => addToast("Could not load the chat.", "error"));
  }
  async function handleTicketSubmit(input: { body: string; category: string | null; files: File[] }) {
    const thread = await createTicket(input);
    setSentThreadId(thread.id);
    setView("sent");
  }

  const ticketThreads = support.threads.filter((t) => t.kind === "ticket");
  const chatUnread = support.threads.some((t) => t.kind === "chat" && t.unreadForUser);

  function tabClass(active: boolean): string {
    return `flex-1 py-2.5 text-[12px] font-semibold transition-colors ${
      active
        ? "border-b-2 border-orange-500 text-orange-600 dark:text-orange-400"
        : "border-b-2 border-transparent text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
    }`;
  }

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96, y: 12 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 380, damping: 32 }}
      style={{ transformOrigin: "bottom right" }}
      className="fixed inset-0 z-50 flex h-dvh w-full flex-col overflow-hidden bg-white dark:bg-[#0c0c0f] sm:inset-auto sm:bottom-5 sm:right-5 sm:h-[600px] sm:max-h-[calc(100dvh-2.5rem)] sm:w-[380px] sm:rounded-2xl sm:border sm:border-gray-200 sm:shadow-2xl sm:dark:border-white/10"
    >
      {/* Main header */}
      <div className="flex shrink-0 items-center gap-2 border-b border-gray-100 px-4 py-3 dark:border-white/[0.06]">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-orange-50 text-orange-500 dark:bg-orange-500/15">
          <LifeBuoy className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-bold text-gray-900 dark:text-white">Support</p>
          <p className="text-[11px] text-gray-400">Chat with the tech team</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close support"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-white/[0.06]"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {tab === "tickets" && view === "thread" && support.activeThread ? (
        /* Drilled into a ticket conversation */
        <div className="min-h-0 flex-1">
          <ThreadView
            thread={support.activeThread}
            messages={support.activeMessages}
            viewerRole="user"
            onBack={backToHome}
            onError={(m) => addToast(m, "error")}
            onSend={async (body, files) => {
              if (support.activeThread) await sendMessage(support.activeThread.id, body, files);
            }}
          />
        </div>
      ) : (
        <>
          {/* Tabs */}
          <div className="flex shrink-0 border-b border-gray-100 dark:border-white/[0.06]">
            <button
              type="button"
              onClick={() => setTab("tickets")}
              className={tabClass(tab === "tickets")}
            >
              Submit a ticket
            </button>
            <button
              type="button"
              onClick={openChatTab}
              className={`relative ${tabClass(tab === "chat")}`}
            >
              Chat
              {chatUnread && (
                <span className="absolute right-[26%] top-2 h-1.5 w-1.5 rounded-full bg-orange-500" />
              )}
            </button>
          </div>

          {/* Body */}
          <div className="min-h-0 flex-1">
            {tab === "chat" ? (
              <ThreadView
                thread={support.activeThread}
                messages={support.activeMessages}
                viewerRole="user"
                hideSubHeader
                emptyLabel="Start a conversation — our tech team will reply right here."
                onError={(m) => addToast(m, "error")}
                onSend={async (body, files) => {
                  await sendChatMessage(body, files);
                }}
              />
            ) : view === "form" ? (
              <TicketForm onSubmit={handleTicketSubmit} onError={(m) => addToast(m, "error")} />
            ) : view === "sent" ? (
              <div className="flex h-full flex-col items-center justify-center p-6 text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50 dark:bg-emerald-500/15">
                  <CheckCircle2 className="h-7 w-7 text-emerald-500" />
                </div>
                <p className="mt-4 text-[15px] font-semibold text-gray-900 dark:text-white">
                  Ticket sent
                </p>
                <p className="mt-1 max-w-[280px] text-[13px] text-gray-500 dark:text-gray-400">
                  Our tech team will reply within 24-48 hours. You&apos;ll get an email when there
                  is an update.
                </p>
                <div className="mt-5 flex w-full max-w-[260px] flex-col gap-2">
                  <button
                    type="button"
                    onClick={() => sentThreadId && goThread(sentThreadId)}
                    className="h-11 rounded-lg bg-orange-500 text-[13px] font-semibold text-white transition-colors hover:bg-orange-600"
                  >
                    View ticket
                  </button>
                  <button
                    type="button"
                    onClick={() => setView("home")}
                    className="h-11 rounded-lg border border-gray-200 text-[13px] font-semibold text-gray-600 transition-colors hover:bg-gray-50 dark:border-white/10 dark:text-gray-300 dark:hover:bg-white/[0.04]"
                  >
                    Done
                  </button>
                </div>
              </div>
            ) : (
              <div className="h-full overflow-y-auto p-4">
                <button
                  type="button"
                  onClick={() => setView("form")}
                  className="flex w-full items-center gap-3 rounded-xl bg-gradient-to-r from-orange-500 to-orange-600 px-4 py-3.5 text-left text-white shadow-sm shadow-orange-500/20 transition-transform hover:scale-[1.01]"
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/20">
                    <Plus className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-[14px] font-semibold">Report an issue</p>
                    <p className="text-[11px] text-white/80">Send a ticket to the tech team</p>
                  </div>
                </button>

                <p className="mb-2 mt-5 px-1 text-[11px] font-bold uppercase tracking-wide text-gray-400">
                  Your tickets
                </p>
                {support.loading && ticketThreads.length === 0 && (
                  <p className="px-1 py-3 text-[12px] text-gray-400">Loading…</p>
                )}
                {!support.loading && ticketThreads.length === 0 && (
                  <p className="px-1 py-3 text-[12px] text-gray-400">
                    No tickets yet. Report an issue and we&apos;ll help you out.
                  </p>
                )}
                <div className="space-y-1.5">
                  {ticketThreads.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => goThread(t.id)}
                      className="flex w-full items-center gap-2 rounded-lg border border-gray-100 px-3 py-2.5 text-left transition-colors hover:border-gray-200 hover:bg-gray-50 dark:border-white/[0.06] dark:hover:bg-white/[0.03]"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] font-medium text-gray-900 dark:text-white">
                          {t.subject || `Ticket #${threadShortCode(t.id)}`}
                        </p>
                        <p className="text-[11px] text-gray-400">
                          #{threadShortCode(t.id)} &middot; {SUPPORT_STATUS_LABEL[t.status]}
                        </p>
                      </div>
                      {t.unreadForUser && (
                        <span className="h-2 w-2 shrink-0 rounded-full bg-orange-500" />
                      )}
                      <ChevronRight className="h-4 w-4 shrink-0 text-gray-300 dark:text-gray-600" />
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </motion.div>
  );
}
