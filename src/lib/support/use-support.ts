"use client";

// Client data layer for the Support Center.
//
// Used by the floating widget (scope "own") and the admin Support Inbox
// (scope "all"). Handles thread/message fetches, the staged attachment
// upload, and a Supabase Realtime subscription so both sides update live.
// Row-level security keeps each user's threads private — the realtime
// filter is workspace-wide, RLS narrows delivery to the caller's own rows.

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useAuth } from "@/lib/auth-context";
import { rowToThread, rowToMessage } from "./types";
import type {
  SupportThread,
  SupportMessage,
  SupportThreadRow,
  SupportMessageRow,
  SupportThreadStatus,
} from "./types";

const BUCKET = "support-attachments";

export interface AttachmentClaim {
  storageKey: string;
  name: string;
}

export interface NewTicketInput {
  body: string;
  category: string | null;
  files: File[];
}

async function apiFetch<T>(
  path: string,
  token: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  const res = await fetch(path, {
    method: options.method || "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  if (!res.ok) {
    const message =
      (json as { error?: string } | null)?.error || "Something went wrong. Please try again.";
    throw new Error(message);
  }
  return json as T;
}

/**
 * Run a callback when the browser is idle, falling back to a short timeout
 * where requestIdleCallback is unavailable (Safari). Returns a canceller.
 */
function onIdle(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const w = window as typeof window & {
    requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
    cancelIdleCallback?: (handle: number) => void;
  };
  if (typeof w.requestIdleCallback === "function") {
    const handle = w.requestIdleCallback(cb, { timeout: 2000 });
    return () => w.cancelIdleCallback?.(handle);
  }
  const t = window.setTimeout(cb, 1200);
  return () => window.clearTimeout(t);
}

/**
 * Upload files straight to Supabase Storage via one-shot signed URLs, then
 * return the storage keys to attach. Keeps large files off the 4.5 MB Vercel
 * function body limit.
 */
async function uploadFiles(files: File[], token: string): Promise<AttachmentClaim[]> {
  if (files.length === 0) return [];
  const { uploads } = await apiFetch<{
    uploads: Array<{ storageKey: string; token: string; name: string }>;
  }>("/api/support/uploads", token, {
    method: "POST",
    body: { files: files.map((f) => ({ name: f.name, mime: f.type, size: f.size })) },
  });
  // Upload every file in parallel — each goes straight to storage and none
  // depends on another.
  await Promise.all(
    uploads.map(async (target, i) => {
      const file = files[i];
      const { error } = await supabase.storage
        .from(BUCKET)
        .uploadToSignedUrl(target.storageKey, target.token, file);
      if (error) {
        throw new Error(`Could not upload "${file.name}". Please try a smaller file.`);
      }
    }),
  );
  return uploads.map((u) => ({ storageKey: u.storageKey, name: u.name }));
}

export type SupportScope = "own" | "all";

export interface UseSupport {
  threads: SupportThread[];
  loading: boolean;
  unreadCount: number;
  activeThread: SupportThread | null;
  activeMessages: SupportMessage[];
  refresh: () => Promise<void>;
  createTicket: (input: NewTicketInput) => Promise<SupportThread>;
  openThread: (threadId: string) => Promise<void>;
  closeThread: () => void;
  sendMessage: (threadId: string, body: string, files: File[]) => Promise<void>;
  markRead: (threadId: string) => Promise<void>;
  setStatus: (threadId: string, status: SupportThreadStatus) => Promise<void>;
  loadChat: () => Promise<void>;
  sendChatMessage: (body: string, files: File[]) => Promise<void>;
}

export function useSupport(scope: SupportScope = "own"): UseSupport {
  const { accessToken, provisionResult } = useAuth();
  const workspaceId = provisionResult?.workspaceId || null;

  const [threads, setThreads] = useState<SupportThread[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeThread, setActiveThread] = useState<SupportThread | null>(null);
  const [activeMessages, setActiveMessages] = useState<SupportMessage[]>([]);

  const activeIdRef = useRef<string | null>(null);
  const loadedRef = useRef(false);

  const refresh = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const path = scope === "all" ? "/api/support/threads?scope=all" : "/api/support/threads";
      const { threads: list } = await apiFetch<{ threads: SupportThread[] }>(path, accessToken);
      setThreads(list);
      loadedRef.current = true;
    } catch (err) {
      console.error("[support] refresh failed:", err);
    } finally {
      setLoading(false);
    }
  }, [accessToken, scope]);

  const upsertThread = useCallback((t: SupportThread) => {
    setThreads((prev) => {
      // Drop any existing copy, add the new one, keep newest-activity-first.
      const others = prev.filter((x) => x.id !== t.id);
      return [t, ...others].sort(
        (a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime(),
      );
    });
    setActiveThread((prev) => (prev && prev.id === t.id ? t : prev));
  }, []);

  const createTicket = useCallback(
    async (input: NewTicketInput): Promise<SupportThread> => {
      if (!accessToken) throw new Error("Please sign in again.");
      const claims = await uploadFiles(input.files, accessToken);
      const { thread } = await apiFetch<{ thread: SupportThread }>(
        "/api/support/threads",
        accessToken,
        { method: "POST", body: { body: input.body, category: input.category, attachments: claims } },
      );
      upsertThread(thread);
      return thread;
    },
    [accessToken, upsertThread],
  );

  const openThread = useCallback(
    async (threadId: string) => {
      if (!accessToken) return;
      activeIdRef.current = threadId;
      try {
        const { thread, messages } = await apiFetch<{
          thread: SupportThread;
          messages: SupportMessage[];
        }>(`/api/support/threads/${threadId}`, accessToken);
        // Ignore a stale response if the user already opened another thread.
        if (activeIdRef.current !== threadId) return;
        setActiveThread(thread);
        setActiveMessages(messages);
      } catch (err) {
        console.error("[support] openThread failed:", err);
        if (activeIdRef.current === threadId) activeIdRef.current = null;
        throw err;
      }
    },
    [accessToken],
  );

  const closeThread = useCallback(() => {
    activeIdRef.current = null;
    setActiveThread(null);
    setActiveMessages([]);
  }, []);

  const sendMessage = useCallback(
    async (threadId: string, body: string, files: File[]) => {
      if (!accessToken) throw new Error("Please sign in again.");
      const claims = await uploadFiles(files, accessToken);
      const { message } = await apiFetch<{ message: SupportMessage }>(
        `/api/support/threads/${threadId}/messages`,
        accessToken,
        { method: "POST", body: { body, attachments: claims } },
      );
      if (activeIdRef.current === threadId) {
        setActiveMessages((prev) =>
          prev.some((m) => m.id === message.id) ? prev : [...prev, message],
        );
      }
    },
    [accessToken],
  );

  const markRead = useCallback(
    async (threadId: string) => {
      if (!accessToken) return;
      try {
        await apiFetch(`/api/support/threads/${threadId}/read`, accessToken, { method: "POST" });
      } catch (err) {
        console.error("[support] markRead failed:", err);
      }
    },
    [accessToken],
  );

  const setStatus = useCallback(
    async (threadId: string, status: SupportThreadStatus) => {
      if (!accessToken) throw new Error("Please sign in again.");
      const { thread } = await apiFetch<{ thread: SupportThread }>(
        `/api/support/threads/${threadId}`,
        accessToken,
        { method: "PATCH", body: { status } },
      );
      upsertThread(thread);
    },
    [accessToken, upsertThread],
  );

  // Load the caller's single live-chat thread into the active slot.
  const loadChat = useCallback(async () => {
    if (!accessToken) return;
    try {
      const { thread, messages } = await apiFetch<{
        thread: SupportThread | null;
        messages: SupportMessage[];
      }>("/api/support/chat", accessToken);
      activeIdRef.current = thread ? thread.id : null;
      setActiveThread(thread);
      setActiveMessages(messages);
      if (thread) {
        void apiFetch(`/api/support/threads/${thread.id}/read`, accessToken, {
          method: "POST",
        }).catch(() => {});
      }
    } catch (err) {
      console.error("[support] loadChat failed:", err);
      throw err;
    }
  }, [accessToken]);

  // Send a chat message; the server lazily creates the chat thread.
  const sendChatMessage = useCallback(
    async (body: string, files: File[]) => {
      if (!accessToken) throw new Error("Please sign in again.");
      const claims = await uploadFiles(files, accessToken);
      const { thread, message } = await apiFetch<{
        thread: SupportThread;
        message: SupportMessage;
      }>("/api/support/chat", accessToken, {
        method: "POST",
        body: { body, attachments: claims },
      });
      upsertThread(thread);
      activeIdRef.current = thread.id;
      setActiveThread(thread);
      setActiveMessages((prev) =>
        prev.some((m) => m.id === message.id) ? prev : [...prev, message],
      );
    },
    [accessToken, upsertThread],
  );

  // Initial load — deferred to browser idle so the support feature never sits
  // in the first-paint critical path. The widget loads closed; its data waits.
  useEffect(() => {
    if (!accessToken || loadedRef.current) return;
    return onIdle(() => {
      if (!loadedRef.current) void refresh();
    });
  }, [accessToken, refresh]);

  // Realtime: thread + message changes for this workspace. RLS narrows the
  // stream to rows the caller may see (own threads, or all for a superadmin).
  // The subscription opens at idle, not on mount — a websocket handshake has
  // no place in the first-paint critical path.
  useEffect(() => {
    if (!workspaceId || !accessToken) return;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    const cancelIdle = onIdle(() => {
      channel = supabase
        .channel(`support-${scope}-${workspaceId}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "support_threads", filter: `workspace_id=eq.${workspaceId}` },
          (payload) => {
            if (payload.eventType === "DELETE") return;
            const row = payload.new as SupportThreadRow;
            if (!row?.id) return;
            upsertThread(rowToThread(row));
          },
        )
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "support_messages", filter: `workspace_id=eq.${workspaceId}` },
          (payload) => {
            const row = payload.new as SupportMessageRow;
            if (!row?.id || row.thread_id !== activeIdRef.current) return;
            const message = rowToMessage(row);
            setActiveMessages((prev) =>
              prev.some((m) => m.id === message.id) ? prev : [...prev, message],
            );
          },
        )
        .subscribe();
    });
    return () => {
      cancelIdle();
      if (channel) void supabase.removeChannel(channel);
    };
  }, [workspaceId, accessToken, scope, upsertThread]);

  const unreadCount = useMemo(
    () =>
      threads.filter((t) => (scope === "all" ? t.unreadForAdmin : t.unreadForUser)).length,
    [threads, scope],
  );

  return {
    threads,
    loading,
    unreadCount,
    activeThread,
    activeMessages,
    refresh,
    createTicket,
    openThread,
    closeThread,
    sendMessage,
    markRead,
    setStatus,
    loadChat,
    sendChatMessage,
  };
}
