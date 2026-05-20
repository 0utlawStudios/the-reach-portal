"use client";

// Discreet floating support widget. A small square trigger sits bottom-right
// on every authenticated page; clicking it opens a Messenger-style panel.
// Shown to end users only — the superadmin answers from Settings → Support
// Inbox, so the widget is hidden for that role.

import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { LifeBuoy, X, Plus, ChevronRight, CheckCircle2 } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useToast } from "@/lib/toast-context";
import { useNavigation } from "@/lib/navigation-context";
import { useSupport } from "@/lib/support/use-support";
import { threadShortCode, SUPPORT_STATUS_LABEL } from "@/lib/support/format";
import { TicketForm } from "./ticket-form";
import { ThreadView } from "./thread-view";

type View = "home" | "form" | "thread" | "sent";

/** Read the ?support=<threadId> deep-link param, if any. */
function deepLinkThreadId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return new URLSearchParams(window.location.search).get("support");
  } catch {
    return null;
  }
}

export function SupportWidget() {
  const { isAuthenticated, currentUser } = useAuth();
  const { addToast } = useToast();
  const { navigateToSupport } = useNavigation();
  const support = useSupport("own");
  // Open immediately if arriving via a ?support= deep link (end users only).
  const [open, setOpen] = useState<boolean>(
    () => deepLinkThreadId() !== null && (currentUser.role || "").toLowerCase() !== "superadmin",
  );
  const [view, setView] = useState<View>("home");
  const [sentThreadId, setSentThreadId] = useState<string | null>(null);
  const deepLinkHandled = useRef(false);

  const { openThread, markRead, closeThread, sendMessage, createTicket } = support;

  const goThread = useCallback(
    async (threadId: string) => {
      try {
        await openThread(threadId);
        setView("thread");
        void markRead(threadId);
      } catch {
        addToast("Could not open that conversation.", "error");
      }
    },
    [openThread, markRead, addToast],
  );

  // Deep link: /?support=<threadId>. End users open the widget straight to
  // that thread; the superadmin is routed to the Settings → Support Inbox tab.
  useEffect(() => {
    if (deepLinkHandled.current || !isAuthenticated) return;
    const params = new URLSearchParams(window.location.search);
    const threadId = params.get("support");
    if (!threadId) return;
    deepLinkHandled.current = true;
    params.delete("support");
    const qs = params.toString();
    window.history.replaceState(null, "", window.location.pathname + (qs ? `?${qs}` : ""));
    if ((currentUser.role || "").toLowerCase() === "superadmin") {
      navigateToSupport(threadId);
    } else {
      // `open` is lazy-initialised true for this deep link. Defer the load to a
      // microtask so it runs as an async callback, not a sync render cascade.
      void Promise.resolve().then(() => goThread(threadId));
    }
  }, [isAuthenticated, currentUser.role, goThread, navigateToSupport]);

  // The widget reaches the tech team; the superadmin uses the Settings inbox.
  if (!isAuthenticated || (currentUser.role || "").toLowerCase() === "superadmin") return null;

  function handleClose() {
    setOpen(false);
  }

  function backHome() {
    closeThread();
    setView("home");
  }

  async function handleTicketSubmit(input: { body: string; category: string | null; files: File[] }) {
    const thread = await createTicket(input);
    setSentThreadId(thread.id);
    setView("sent");
  }

  const closeButton = (
    <button
      type="button"
      onClick={handleClose}
      aria-label="Close support"
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-white/[0.06]"
    >
      <X className="h-4 w-4" />
    </button>
  );

  return (
    <>
      {/* Discreet trigger */}
      <AnimatePresence>
        {!open && (
          <motion.button
            type="button"
            key="support-trigger"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            transition={{ duration: 0.15 }}
            onClick={() => setOpen(true)}
            aria-label="Get support"
            className="fixed bottom-5 right-5 z-40 flex h-11 w-11 items-center justify-center rounded-2xl border border-gray-200 bg-white/95 text-gray-500 shadow-lg shadow-black/[0.06] backdrop-blur transition-all hover:border-orange-300 hover:text-orange-500 hover:shadow-xl dark:border-white/10 dark:bg-[#16161a]/95 dark:text-gray-400"
          >
            <LifeBuoy className="h-5 w-5" />
            {support.unreadCount > 0 && (
              <span className="absolute -right-1 -top-1 h-3 w-3 rounded-full bg-orange-500 ring-2 ring-white dark:ring-[#0a0a0a]" />
            )}
          </motion.button>
        )}
      </AnimatePresence>

      {/* Panel */}
      <AnimatePresence>
        {open && (
          <motion.div
            key="support-panel"
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 12 }}
            transition={{ type: "spring", stiffness: 380, damping: 32 }}
            style={{ transformOrigin: "bottom right" }}
            className="fixed inset-0 z-50 flex h-dvh w-full flex-col overflow-hidden bg-white dark:bg-[#0c0c0f] sm:inset-auto sm:bottom-5 sm:right-5 sm:h-[600px] sm:max-h-[calc(100dvh-2.5rem)] sm:w-[380px] sm:rounded-2xl sm:border sm:border-gray-200 sm:shadow-2xl sm:dark:border-white/10"
          >
            {view === "thread" && support.activeThread ? (
              <ThreadView
                thread={support.activeThread}
                messages={support.activeMessages}
                viewerRole="user"
                onBack={backHome}
                headerExtra={closeButton}
                onError={(m) => addToast(m, "error")}
                onSend={async (body, files) => {
                  await sendMessage(support.activeThread!.id, body, files);
                }}
              />
            ) : (
              <>
                {/* Header */}
                <div className="flex shrink-0 items-center gap-2 border-b border-gray-100 px-4 py-3 dark:border-white/[0.06]">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-orange-50 text-orange-500 dark:bg-orange-500/15">
                    <LifeBuoy className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[14px] font-bold text-gray-900 dark:text-white">
                      {view === "form" ? "Report an issue" : "Support"}
                    </p>
                    <p className="text-[11px] text-gray-400">Chat with the tech team</p>
                  </div>
                  {closeButton}
                </div>

                {/* Body */}
                {view === "form" && (
                  <div className="min-h-0 flex-1">
                    <TicketForm
                      onSubmit={handleTicketSubmit}
                      onError={(m) => addToast(m, "error")}
                    />
                  </div>
                )}

                {view === "sent" && (
                  <div className="flex min-h-0 flex-1 flex-col items-center justify-center p-6 text-center">
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
                )}

                {view === "home" && (
                  <div className="min-h-0 flex-1 overflow-y-auto p-4">
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
                    {support.loading && support.threads.length === 0 && (
                      <p className="px-1 py-3 text-[12px] text-gray-400">Loading…</p>
                    )}
                    {!support.loading && support.threads.length === 0 && (
                      <p className="px-1 py-3 text-[12px] text-gray-400">
                        No tickets yet. Report an issue and we&apos;ll help you out.
                      </p>
                    )}
                    <div className="space-y-1.5">
                      {support.threads.map((t) => (
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
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
