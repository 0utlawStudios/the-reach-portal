"use client";

import { createContext, useContext, useState, useCallback, useMemo, useEffect, useRef, ReactNode } from "react";
import { ContentCard, PipelineStage, DEFAULT_CHECKLIST, PIPELINE_COLUMNS, isPlatform } from "./types";
import { PLACEHOLDER_CARDS } from "./placeholder-data";
import { loadState, saveState } from "./persistence";
import { supabase } from "./supabaseClient";
import { logAudit } from "./audit";
import { useAuth } from "./auth-context";

const STORAGE_KEY = "pipeline_cards";
const POSTS_SELECT_FULL = "*, publish_jobs(state, platform_publish_attempts(platform, state, external_post_id))";
const POSTS_SELECT_BASIC = "*";

function isValidUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

// ─── Supabase <-> ContentCard mappers ───

type PublishAttemptRow = {
  platform?: string | null;
  state?: string | null;
  external_post_id?: string | null;
};

type PublishJobRow = {
  state?: string | null;
  platform_publish_attempts?: PublishAttemptRow[] | PublishAttemptRow | null;
};

type PostRow = {
  id: string;
  title: string;
  stage: PipelineStage;
  platforms?: string[] | null;
  content_type: ContentCard["contentType"];
  thumbnail_url?: string | null;
  scheduled_date?: string | null;
  scheduled_time?: string | null;
  scheduled_at?: string | null;
  caption?: string | null;
  hook?: string | null;
  notes?: string | null;
  checklist?: ContentCard["checklist"] | null;
  media_ids?: string[] | null;
  source_vault?: ContentCard["sourceVault"] | null;
  asset_source?: ContentCard["assetSource"] | null;
  license_file_id?: string | null;
  created_by?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  publish_jobs?: PublishJobRow[] | PublishJobRow | null;
};

type PostUpdate = {
  title?: string;
  stage?: PipelineStage;
  platforms?: string[];
  content_type?: ContentCard["contentType"];
  thumbnail_url?: string | null;
  scheduled_date?: string | null;
  scheduled_time?: string | null;
  scheduled_at?: string | null;
  caption?: string | null;
  hook?: string | null;
  notes?: string | null;
  checklist?: ContentCard["checklist"];
  media_ids?: string[];
  source_vault?: ContentCard["sourceVault"];
  asset_source?: ContentCard["assetSource"] | null;
  license_file_id?: string | null;
  created_by?: string | null;
};

function normalizePlatforms(platforms?: string[] | null): ContentCard["platforms"] {
  return (platforms || []).filter(isPlatform);
}

function normalizePublishJob(raw: PostRow["publish_jobs"]): ContentCard["publishJob"] | undefined {
  const job = Array.isArray(raw) ? raw[0] : raw;
  if (!job) return undefined;

  const rawAttempts = job.platform_publish_attempts;
  const attempts = Array.isArray(rawAttempts) ? rawAttempts : rawAttempts ? [rawAttempts] : [];

  return {
    state: job.state || "",
    platformAttempts: attempts.map((attempt) => ({
      platform: attempt.platform || "",
      state: attempt.state || "",
      externalPostId: attempt.external_post_id ?? null,
    })),
  };
}

function toScheduledAt(date?: string, time?: string): string | null | undefined {
  if (date === undefined && time === undefined) return undefined;
  if (!date || !time) return null;

  const parsed = new Date(`${date}T${time}`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function dbToCard(row: PostRow): ContentCard {
  const notes = row.notes || undefined;
  // Reconstruct revised flag from notes — if notes contain "Revision Note" entries, card was revised
  const revised = notes ? /(Revision Note \(|Fix submitted —)/.test(notes) : false;
  // Reconstruct revision history from notes
  const revisionHistory: { note: string; by: string; at: string }[] = [];
  if (notes) {
    const oldFmt = notes.matchAll(/Revision Note \(([^)]+)\): (.+?)(?=\n\n|$)/g);
    for (const m of oldFmt) revisionHistory.push({ note: m[2], by: "Revision Note", at: m[1] });
    const newFmt = notes.matchAll(/(.+?)\s*\(([^)]+)\):\s*Fix submitted — (.+?)(?=\n\n|$)/g);
    for (const m of newFmt) revisionHistory.push({ note: m[3], by: m[1].trim(), at: m[2] });
  }
  return {
    id: row.id,
    title: row.title,
    stage: row.stage,
    platforms: normalizePlatforms(row.platforms),
    contentType: row.content_type,
    thumbnailUrl: row.thumbnail_url || "",
    scheduledDate: row.scheduled_date || undefined,
    scheduledTime: row.scheduled_time?.slice(0, 5) || undefined,
    caption: row.caption || undefined,
    hook: row.hook || undefined,
    notes,
    checklist: row.checklist || DEFAULT_CHECKLIST.map((c) => ({ ...c })),
    mediaIds: row.media_ids || undefined,
    revised,
    revisionHistory: revisionHistory.length > 0 ? revisionHistory : undefined,
    sourceVault: row.source_vault || undefined,
    assetSource: row.asset_source || undefined,
    licenseFileId: row.license_file_id || undefined,
    createdBy: row.created_by || undefined,
    publishJob: normalizePublishJob(row.publish_jobs),
    createdAt: row.created_at?.split("T")[0] || new Date().toISOString().split("T")[0],
    updatedAt: row.updated_at?.split("T")[0] || new Date().toISOString().split("T")[0],
  };
}

function cardToDb(card: Partial<ContentCard> & { id?: string }): PostUpdate {
  const obj: PostUpdate = {};
  if (card.title !== undefined) obj.title = card.title;
  if (card.stage !== undefined) obj.stage = card.stage;
  if (card.platforms !== undefined) obj.platforms = card.platforms;
  if (card.contentType !== undefined) obj.content_type = card.contentType;
  if (card.thumbnailUrl !== undefined) obj.thumbnail_url = card.thumbnailUrl;
  if (card.scheduledDate !== undefined) obj.scheduled_date = card.scheduledDate || null;
  if (card.scheduledTime !== undefined) obj.scheduled_time = card.scheduledTime || null;
  if (card.scheduledDate !== undefined || card.scheduledTime !== undefined) obj.scheduled_at = toScheduledAt(card.scheduledDate, card.scheduledTime) ?? null;
  if (card.caption !== undefined) obj.caption = card.caption || null;
  if (card.hook !== undefined) obj.hook = card.hook || null;
  if (card.notes !== undefined) obj.notes = card.notes || null;
  if (card.checklist !== undefined) obj.checklist = card.checklist;
  if (card.mediaIds !== undefined) obj.media_ids = card.mediaIds || [];
  if (card.sourceVault !== undefined) obj.source_vault = card.sourceVault || {};
  if (card.assetSource !== undefined) obj.asset_source = card.assetSource || null;
  if (card.licenseFileId !== undefined) obj.license_file_id = card.licenseFileId || null;
  if (card.createdBy !== undefined) obj.created_by = card.createdBy || null;
  return obj;
}

function isSupabaseConfigured(): boolean {
  return !!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

async function createPublishJob(postId: string): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession();
  const headers: HeadersInit = { "Content-Type": "application/json" };
  if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;

  const res = await fetch("/api/publish-jobs", {
    method: "POST",
    headers,
    body: JSON.stringify({ postId }),
  });

  if (!res.ok) {
    let message = "Failed to create publish job";
    try {
      const body = await res.json();
      if (typeof body?.error === "string") message = body.error;
    } catch { /* keep fallback */ }
    throw new Error(message);
  }
}

// ─── Context ───

interface PendingReapproval {
  cardId: string;
  cardTitle: string;
}

interface PendingKickback {
  cardId: string;
  cardTitle: string;
}

interface PipelineContextType {
  cards: ContentCard[];
  selectedCard: ContentCard | null;
  isDrawerOpen: boolean;
  isEditingOnOpen: boolean;
  pendingReapproval: PendingReapproval | null;
  pendingKickback: PendingKickback | null;
  selectCard: (card: ContentCard) => void;
  selectCardForEditing: (card: ContentCard) => void;
  closeDrawer: () => void;
  moveCard: (cardId: string, newStage: PipelineStage) => void;
  requestReapproval: (cardId: string) => void;
  submitReapproval: (cardId: string, note: string) => void;
  cancelReapproval: () => void;
  requestKickback: (cardId: string) => void;
  submitKickback: (cardId: string, note: string, attachmentUrl?: string) => void;
  cancelKickback: () => void;
  updateCard: (cardId: string, updates: Partial<ContentCard>) => void;
  createCard: (card: Partial<Pick<ContentCard, "checklist">> & Omit<ContentCard, "id" | "createdAt" | "updatedAt" | "checklist">) => void;
  deleteCard: (cardId: string) => void;
}

const PipelineContext = createContext<PipelineContextType | null>(null);

export function PipelineProvider({ children }: { children: ReactNode }) {
  const { currentUser } = useAuth();
  const [cards, setCards] = useState<ContentCard[]>(PLACEHOLDER_CARDS);
  const [selectedCard, setSelectedCard] = useState<ContentCard | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [isEditingOnOpen, setIsEditingOnOpen] = useState(false);
  const [pendingReapproval, setPendingReapproval] = useState<PendingReapproval | null>(null);
  const [pendingKickback, setPendingKickback] = useState<PendingKickback | null>(null);
  const hydrated = useRef(false);
  const postsSelect = useRef(POSTS_SELECT_FULL);
  const workspaceIdRef = useRef<string | null>(null);
  const useSupabase = isSupabaseConfigured();

  // Track local mutations to prevent realtime echo (dedup)
  const recentMutations = useRef<Set<string>>(new Set());
  const markMutation = (id: string) => {
    recentMutations.current.add(id);
    setTimeout(() => recentMutations.current.delete(id), 2000);
  };

  // ─── Initial data load ───
  useEffect(() => {
    async function load() {
      if (useSupabase) {
        try {
          // Resolve user's workspace for future inserts
          try {
            const { data: { user } } = await supabase.auth.getUser();
            if (user) {
              const { data: membership } = await supabase
                .from("workspace_members")
                .select("workspace_id")
                .eq("user_id", user.id)
                .eq("status", "active")
                .limit(1)
                .maybeSingle();
              if (membership) workspaceIdRef.current = membership.workspace_id;
            }
          } catch { /* workspace_members may not exist yet */ }

          // Try full select (with publish_jobs join); fall back if tables missing
          let result = await supabase.from("posts").select(POSTS_SELECT_FULL).order("created_at", { ascending: false });
          if (result.error) {
            postsSelect.current = POSTS_SELECT_BASIC;
            result = await supabase.from("posts").select(POSTS_SELECT_BASIC).order("created_at", { ascending: false });
          }
          if (!result.error && result.data) {
            setCards(result.data.map(dbToCard));
          } else {
            setCards(loadState(STORAGE_KEY, PLACEHOLDER_CARDS));
          }
        } catch {
          setCards(loadState(STORAGE_KEY, PLACEHOLDER_CARDS));
        }
      } else {
        setCards(loadState(STORAGE_KEY, PLACEHOLDER_CARDS));
      }
      hydrated.current = true;
    }
    load();
  }, [useSupabase]);

  // ─── Realtime subscription ───
  useEffect(() => {
    if (!useSupabase) return;

    const channel = supabase
      .channel("posts-realtime")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "posts" },
        (payload) => {
          const newCard = dbToCard(payload.new as PostRow);
          // Skip if this was our own insert (dedup)
          if (recentMutations.current.has("create")) return;
          setCards((prev) => {
            if (prev.some((c) => c.id === newCard.id)) return prev;
            return [newCard, ...prev];
          });
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "posts" },
        (payload) => {
          const fallback = dbToCard(payload.new as PostRow);
          // Skip if this was our own update (dedup)
          if (recentMutations.current.has(fallback.id)) return;
          supabase.from("posts").select(postsSelect.current).eq("id", fallback.id).maybeSingle().then(({ data }) => {
            const updated = dbToCard((data as PostRow | null) || (payload.new as PostRow));
            setCards((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
            // Also update selectedCard if it's the same post
            setSelectedCard((prev) => (prev?.id === updated.id ? updated : prev));
          });
        }
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "posts" },
        (payload) => {
          const deletedId = (payload.old as Partial<PostRow>).id;
          if (!deletedId || recentMutations.current.has(deletedId)) return;
          setCards((prev) => prev.filter((c) => c.id !== deletedId));
          setSelectedCard((prev) => (prev?.id === deletedId ? null : prev));
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [useSupabase]);

  // ─── Persist localStorage backup ───
  useEffect(() => {
    if (hydrated.current) saveState(STORAGE_KEY, cards);
  }, [cards]);

  // ─── Actions ───

  const selectCard = useCallback((card: ContentCard) => {
    setSelectedCard(card);
    setIsDrawerOpen(true);
    setIsEditingOnOpen(false);
  }, []);

  const selectCardForEditing = useCallback((card: ContentCard) => {
    setSelectedCard(card);
    setIsDrawerOpen(true);
    setIsEditingOnOpen(true);
  }, []);

  const closeDrawer = useCallback(() => {
    setIsDrawerOpen(false);
    setSelectedCard(null);
    setIsEditingOnOpen(false);
  }, []);

  const moveCard = useCallback((cardId: string, newStage: PipelineStage) => {
    // INTERCEPT: revision_needed → awaiting_approval requires a note
    const card = cards.find((c) => c.id === cardId);
    if (card?.stage === "revision_needed" && newStage === "awaiting_approval") {
      setPendingReapproval({ cardId, cardTitle: card.title });
      return; // Don't move yet — modal will handle it
    }

    // Normal move
    const fromStage = card?.stage || "unknown";
    const toLabel = PIPELINE_COLUMNS.find((c) => c.id === newStage)?.title || newStage;
    const fromLabel = PIPELINE_COLUMNS.find((c) => c.id === fromStage)?.title || fromStage;
    setCards((prev) => prev.map((c) => {
      if (c.id !== cardId) return c;
      return { ...c, stage: newStage, updatedAt: new Date().toISOString().split("T")[0] };
    }));
    setSelectedCard((prev) => (prev?.id === cardId ? { ...prev, stage: newStage } : prev));
    if (useSupabase && isValidUuid(cardId)) {
      const rollback = () => {
        setCards((prev) => prev.map((c) => c.id === cardId ? { ...c, stage: fromStage as PipelineStage } : c));
        setSelectedCard((prev) => prev?.id === cardId ? { ...prev, stage: fromStage as PipelineStage } : prev);
      };
      markMutation(cardId);
      (async () => {
        let stageUpdated = false;
        try {
          const { error } = await supabase.from("posts").update({ stage: newStage }).eq("id", cardId);
          if (error) throw error;
          stageUpdated = true;

          if (newStage === "approved_scheduled" && card?.scheduledDate && card.scheduledTime) {
            await createPublishJob(cardId);
          }

          if (newStage === "awaiting_approval") {
            supabase.auth.getSession().then(({ data: { session } }) => {
              const headers: HeadersInit = { "Content-Type": "application/json" };
              if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
              fetch("/api/notifications/awaiting-approval", {
                method: "POST",
                headers,
                body: JSON.stringify({ postId: cardId, postTitle: card?.title || "", movedBy: currentUser.name, fromStage }),
              }).catch((e) => console.error("[pipeline] awaiting-approval notify failed:", e));
            }).catch(() => {});
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.error("[pipeline] stage_change failed:", message);
          rollback();
          if (stageUpdated) {
            markMutation(cardId);
            await supabase.from("posts").update({ stage: fromStage }).eq("id", cardId);
          }
        }
      })();
    }
    logAudit(cardId, currentUser.name, "stage_change", `Moved from ${fromLabel} to ${toLabel}`);
  }, [useSupabase, cards, currentUser.name]);

  const requestReapproval = useCallback((cardId: string) => {
    const card = cards.find((c) => c.id === cardId);
    if (card) setPendingReapproval({ cardId, cardTitle: card.title });
  }, [cards]);

  const submitReapproval = useCallback((cardId: string, note: string) => {
    const now = new Date();
    const timestamp = now.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    const author = currentUser.name;
    const historyEntry = { note, by: author, at: now.toISOString() };
    const noteLine = `${author} (${timestamp}): Fix submitted — ${note}`;

    setCards((prev) => prev.map((c) => {
      if (c.id !== cardId) return c;
      const revisionHistory = [...(c.revisionHistory || []), historyEntry];
      const notes = c.notes ? c.notes + "\n\n" + noteLine : noteLine;
      return { ...c, stage: "awaiting_approval" as PipelineStage, revised: true, revisionHistory, notes, updatedAt: now.toISOString().split("T")[0] };
    }));
    setSelectedCard((prev) => {
      if (prev?.id !== cardId) return prev;
      const revisionHistory = [...(prev.revisionHistory || []), historyEntry];
      const notes = prev.notes ? prev.notes + "\n\n" + noteLine : noteLine;
      return { ...prev, stage: "awaiting_approval" as PipelineStage, revised: true, revisionHistory, notes };
    });

    if (useSupabase && isValidUuid(cardId)) {
      markMutation(cardId);
      const card = cards.find((c) => c.id === cardId);
      const notes = card?.notes ? card.notes + "\n\n" + noteLine : noteLine;
      supabase.from("posts").update({ stage: "awaiting_approval", notes }).eq("id", cardId).then(({ error }) => {
        if (error) { console.error("[pipeline] reapproval sync failed:", error.message); return; }
        supabase.auth.getSession().then(({ data: { session } }) => {
          const headers: HeadersInit = { "Content-Type": "application/json" };
          if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
          fetch("/api/notifications/awaiting-approval", {
            method: "POST",
            headers,
            body: JSON.stringify({ postId: cardId, postTitle: card?.title || "", movedBy: author, fromStage: "revision_needed" }),
          }).catch((e) => console.error("[pipeline] awaiting-approval notify failed:", e));
        }).catch(() => {});
      });
    }

    setPendingReapproval(null);
    logAudit(cardId, author, "revision_submitted", `Fix submitted: ${note}`);
  }, [useSupabase, cards, currentUser.name]);

  const cancelReapproval = useCallback(() => {
    setPendingReapproval(null);
  }, []);

  // ─── Kickback flow (Awaiting Approval → Revision Needed) ───

  const requestKickback = useCallback((cardId: string) => {
    const card = cards.find((c) => c.id === cardId);
    if (card) setPendingKickback({ cardId, cardTitle: card.title });
  }, [cards]);

  const submitKickback = useCallback((cardId: string, note: string, attachmentUrl?: string) => {
    const now = new Date();
    const timestamp = now.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    const author = currentUser.name;
    let noteLine = `${author} (${timestamp}): Revision requested — ${note}`;
    if (attachmentUrl) noteLine += `\n📎 ${attachmentUrl}`;

    setCards((prev) => prev.map((c) => {
      if (c.id !== cardId) return c;
      const notes = c.notes ? c.notes + "\n\n" + noteLine : noteLine;
      return { ...c, stage: "revision_needed" as PipelineStage, revised: false, notes, updatedAt: now.toISOString().split("T")[0] };
    }));
    setSelectedCard((prev) => {
      if (prev?.id !== cardId) return prev;
      const notes = prev.notes ? prev.notes + "\n\n" + noteLine : noteLine;
      return { ...prev, stage: "revision_needed" as PipelineStage, revised: false, notes };
    });

    if (useSupabase && isValidUuid(cardId)) {
      markMutation(cardId);
      const card = cards.find((c) => c.id === cardId);
      const notes = card?.notes ? card.notes + "\n\n" + noteLine : noteLine;
      supabase.from("posts").update({ stage: "revision_needed", notes }).eq("id", cardId).then(({ error }) => {
        if (error) console.error("[pipeline] kickback sync failed:", error.message);
      });
    }

    setPendingKickback(null);
    logAudit(cardId, author, "revision_requested", `Kickback: ${note}`);
  }, [useSupabase, cards, currentUser.name]);

  const cancelKickback = useCallback(() => {
    setPendingKickback(null);
  }, []);

  const updateCard = useCallback((cardId: string, updates: Partial<ContentCard>) => {
    setCards((prev) => prev.map((c) => (c.id === cardId ? { ...c, ...updates } : c)));
    setSelectedCard((prev) => (prev?.id === cardId ? { ...prev, ...updates } : prev));
    if (useSupabase && isValidUuid(cardId)) {
      markMutation(cardId);
      supabase.from("posts").update(cardToDb(updates)).eq("id", cardId).then(({ error }) => {
        if (error) console.error("[pipeline] updateCard sync failed:", error.message);
      });
    }
  }, [useSupabase]);

  const createCard = useCallback((card: Partial<Pick<ContentCard, "checklist">> & Omit<ContentCard, "id" | "createdAt" | "updatedAt" | "checklist">) => {
    const now = new Date().toISOString();
    const tempId = Date.now().toString();
    const newCard: ContentCard = {
      ...card,
      id: tempId,
      createdAt: now,
      updatedAt: now,
      checklist: card.checklist || DEFAULT_CHECKLIST.map((c) => ({ ...c })),
    };
    setCards((prev) => [newCard, ...prev]);

    if (useSupabase) {
      markMutation("create");
      const dbRow = cardToDb(newCard);
      dbRow.checklist = newCard.checklist;
      const insertRow: Record<string, unknown> = { ...dbRow };
      insertRow.workspace_id = workspaceIdRef.current || "00000000-0000-0000-0000-000000000001";
      supabase.from("posts").insert(insertRow).select().single().then(({ data, error }) => {
        if (error) {
          console.error("[pipeline] createCard sync failed:", error.message);
        } else if (data) {
          setCards((prev) => prev.map((c) => c.id === tempId ? { ...c, id: data.id } : c));
        }
      });
    }
  }, [useSupabase]);

  const deleteCard = useCallback((cardId: string) => {
    setCards((prev) => prev.filter((c) => c.id !== cardId));
    setSelectedCard((prev) => (prev?.id === cardId ? null : prev));
    setIsDrawerOpen((open) => {
      if (selectedCard?.id === cardId) return false;
      return open;
    });
    if (useSupabase && isValidUuid(cardId)) {
      markMutation(cardId);
      supabase.from("posts").delete().eq("id", cardId).then(({ error }) => {
        if (error) console.error("[pipeline] deleteCard sync failed:", error.message);
      });
    }
  }, [selectedCard, useSupabase]);

  const value = useMemo(
    () => ({ cards, selectedCard, isDrawerOpen, isEditingOnOpen, pendingReapproval, pendingKickback, selectCard, selectCardForEditing, closeDrawer, moveCard, requestReapproval, submitReapproval, cancelReapproval, requestKickback, submitKickback, cancelKickback, updateCard, createCard, deleteCard }),
    [cards, selectedCard, isDrawerOpen, isEditingOnOpen, pendingReapproval, pendingKickback, selectCard, selectCardForEditing, closeDrawer, moveCard, requestReapproval, submitReapproval, cancelReapproval, requestKickback, submitKickback, cancelKickback, updateCard, createCard, deleteCard]
  );

  return <PipelineContext.Provider value={value}>{children}</PipelineContext.Provider>;
}

export function usePipeline() {
  const ctx = useContext(PipelineContext);
  if (!ctx) throw new Error("usePipeline must be used within PipelineProvider");
  return ctx;
}
