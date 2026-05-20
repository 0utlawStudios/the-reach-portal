"use client";

// Admin Support Inbox — every ticket and chat in the workspace. Rendered as a
// superadmin-only tab inside Settings. Two-pane on desktop, list/detail on
// mobile. Reuses ThreadView for the conversation and reply composer.

import { useState, useMemo, useCallback, useEffect } from "react";
import { Inbox, RefreshCw, Loader2 } from "lucide-react";
import { useToast } from "@/lib/toast-context";
import { useNavigation } from "@/lib/navigation-context";
import { useSupport } from "@/lib/support/use-support";
import { threadShortCode, categoryLabel, SUPPORT_STATUS_LABEL } from "@/lib/support/format";
import type { SupportThreadStatus } from "@/lib/support/types";
import { ThreadView } from "./thread-view";
import { RecipientPicker } from "./recipient-picker";

const KIND_FILTERS = [
  { id: "all", label: "All" },
  { id: "ticket", label: "Tickets" },
  { id: "chat", label: "Chats" },
] as const;

const STATUS_OPTIONS: Array<{ id: SupportThreadStatus | "all"; label: string }> = [
  { id: "all", label: "All statuses" },
  { id: "open", label: "Open" },
  { id: "in_progress", label: "In Progress" },
  { id: "resolved", label: "Resolved" },
  { id: "closed", label: "Closed" },
];

const ALL_STATUSES: SupportThreadStatus[] = ["open", "in_progress", "resolved", "closed"];

const STATUS_DOT: Record<SupportThreadStatus, string> = {
  open: "bg-blue-500",
  in_progress: "bg-amber-500",
  resolved: "bg-emerald-500",
  closed: "bg-gray-400",
};

function listTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  return d.toDateString() === now.toDateString()
    ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : d.toLocaleDateString([], { month: "short", day: "numeric" });
}

export function SupportInbox() {
  const { addToast } = useToast();
  const { pendingSupportThreadId, clearPendingSupport } = useNavigation();
  const support = useSupport("all");
  const [kindFilter, setKindFilter] = useState<(typeof KIND_FILTERS)[number]["id"]>("all");
  const [statusFilter, setStatusFilter] = useState<SupportThreadStatus | "all">("all");
  const [starting, setStarting] = useState(false);
  // Lazy-initialised from a deep link so the effect below never setStates sync.
  const [selectedId, setSelectedId] = useState<string | null>(() => pendingSupportThreadId);

  const { openThread, markRead, closeThread, sendMessage, setStatus, refresh, activeThread } = support;

  const filtered = useMemo(
    () =>
      support.threads.filter(
        (t) =>
          (kindFilter === "all" || t.kind === kindFilter) &&
          (statusFilter === "all" || t.status === statusFilter),
      ),
    [support.threads, kindFilter, statusFilter],
  );

  const select = useCallback(
    async (id: string) => {
      setSelectedId(id);
      try {
        await openThread(id);
        void markRead(id);
      } catch {
        addToast("Could not open that conversation.", "error");
      }
    },
    [openThread, markRead, addToast],
  );

  function deselect() {
    setSelectedId(null);
    closeThread();
  }

  // The inbox is opened deliberately, so fetch immediately rather than waiting
  // for the useSupport hook's idle-deferred page-load fetch.
  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Deep link from a Telegram or email notification. selectedId is
  // lazy-initialised above; here we load the thread and mark it read.
  useEffect(() => {
    if (!pendingSupportThreadId) return;
    const id = pendingSupportThreadId;
    clearPendingSupport();
    void openThread(id);
    void markRead(id);
  }, [pendingSupportThreadId, openThread, markRead, clearPendingSupport]);

  async function handleStatusChange(status: SupportThreadStatus) {
    if (!activeThread) return;
    try {
      await setStatus(activeThread.id, status);
    } catch (err) {
      addToast(err instanceof Error ? err.message : "Could not update status.", "error");
    }
  }

  async function handleStartChat(email: string) {
    if (starting) return;
    setStarting(true);
    try {
      const thread = await support.startChatWith(email);
      setSelectedId(thread.id);
    } catch (err) {
      addToast(err instanceof Error ? err.message : "Could not start the chat.", "error");
    } finally {
      setStarting(false);
    }
  }

  const detailReady = activeThread && activeThread.id === selectedId;

  return (
    <div className="flex h-[72vh] min-h-[460px] overflow-hidden rounded-xl border border-gray-200 dark:border-white/[0.08]">
      {/* List pane */}
      <div
        className={`w-full flex-col md:flex md:w-[320px] md:border-r md:border-gray-200 md:dark:border-white/[0.08] ${
          selectedId ? "hidden" : "flex"
        }`}
      >
        <div className="shrink-0 space-y-2 border-b border-gray-100 p-3 dark:border-white/[0.06]">
          <RecipientPicker onPick={handleStartChat} busy={starting} />
          <div className="flex items-center justify-between gap-2">
            <div className="flex gap-1">
              {KIND_FILTERS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setKindFilter(f.id)}
                  className={`h-7 rounded-md px-2.5 text-[11px] font-medium transition-colors ${
                    kindFilter === f.id
                      ? "bg-orange-500 text-white"
                      : "text-gray-500 hover:bg-gray-100 dark:hover:bg-white/[0.06]"
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => void refresh()}
              aria-label="Refresh"
              className="flex h-7 w-7 items-center justify-center rounded-md text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-white/[0.06]"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${support.loading ? "animate-spin" : ""}`} />
            </button>
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as SupportThreadStatus | "all")}
            className="h-8 w-full rounded-md border border-gray-200 bg-white px-2 text-[12px] text-gray-700 outline-none dark:border-white/10 dark:bg-white/[0.03] dark:text-gray-200"
          >
            {STATUS_OPTIONS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex-1 overflow-y-auto">
          {filtered.length === 0 ? (
            <p className="px-3 py-8 text-center text-[12px] text-gray-400">
              {support.loading ? "Loading…" : "No conversations."}
            </p>
          ) : (
            filtered.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => void select(t.id)}
                className={`flex w-full flex-col gap-1 border-b border-gray-50 px-3 py-2.5 text-left transition-colors dark:border-white/[0.04] ${
                  selectedId === t.id
                    ? "bg-orange-50 dark:bg-orange-500/10"
                    : "hover:bg-gray-50 dark:hover:bg-white/[0.03]"
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${STATUS_DOT[t.status]}`} />
                  <span
                    className={`min-w-0 flex-1 truncate text-[13px] text-gray-900 dark:text-white ${
                      t.unreadForAdmin ? "font-bold" : "font-semibold"
                    }`}
                  >
                    {t.createdByName}
                  </span>
                  {t.unreadForAdmin && (
                    <span className="h-2 w-2 shrink-0 rounded-full bg-orange-500" />
                  )}
                  <span className="shrink-0 text-[10px] text-gray-400">
                    {listTime(t.lastMessageAt)}
                  </span>
                </div>
                <p className="truncate text-[12px] text-gray-500 dark:text-gray-400">
                  {t.subject || (t.kind === "chat" ? "Live chat" : "Ticket")}
                </p>
                <p className="text-[10px] text-gray-400">
                  #{threadShortCode(t.id)} &middot; {t.kind === "chat" ? "Chat" : categoryLabel(t.category)}{" "}
                  &middot; {SUPPORT_STATUS_LABEL[t.status]}
                </p>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Detail pane */}
      <div
        className={`flex-1 flex-col bg-white dark:bg-[#0c0c0f] ${
          selectedId ? "flex" : "hidden md:flex"
        }`}
      >
        {detailReady && activeThread ? (
          <ThreadView
            thread={activeThread}
            messages={support.activeMessages}
            viewerRole="admin"
            onBack={deselect}
            onError={(m) => addToast(m, "error")}
            onSend={async (body, files) => {
              await sendMessage(activeThread.id, body, files);
            }}
            headerExtra={
              <select
                value={activeThread.status}
                onChange={(e) => void handleStatusChange(e.target.value as SupportThreadStatus)}
                className="h-8 shrink-0 rounded-md border border-gray-200 bg-white px-2 text-[11px] font-medium text-gray-700 outline-none dark:border-white/10 dark:bg-white/[0.03] dark:text-gray-200"
              >
                {ALL_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {SUPPORT_STATUS_LABEL[s]}
                  </option>
                ))}
              </select>
            }
          />
        ) : selectedId ? (
          <div className="flex flex-1 flex-col items-center justify-center text-gray-400">
            <Loader2 className="h-6 w-6 animate-spin" />
            <p className="mt-2 text-[13px]">Loading conversation…</p>
          </div>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center text-gray-400">
            <Inbox className="h-8 w-8" />
            <p className="mt-2 text-[13px]">Select a conversation to read and reply</p>
          </div>
        )}
      </div>
    </div>
  );
}
