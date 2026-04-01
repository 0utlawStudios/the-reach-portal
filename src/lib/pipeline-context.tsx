"use client";

import { createContext, useContext, useState, useCallback, useMemo, useEffect, useRef, ReactNode } from "react";
import { ContentCard, PipelineStage, DEFAULT_CHECKLIST, PIPELINE_COLUMNS } from "./types";
import { PLACEHOLDER_CARDS } from "./placeholder-data";
import { loadState, saveState } from "./persistence";
import { supabase } from "./supabaseClient";
import { logAudit } from "./audit";
import { useAuth } from "./auth-context";

const STORAGE_KEY = "pipeline_cards";

// ─── Supabase <-> ContentCard mappers ───

function dbToCard(row: any): ContentCard {
  const notes = row.notes || undefined;
  // Reconstruct revised flag from notes — if notes contain "Revision Note" entries, card was revised
  const revised = notes ? /Revision Note \(/.test(notes) : false;
  // Reconstruct revision history from notes
  const revisionHistory: { note: string; by: string; at: string }[] = [];
  if (notes) {
    const matches = notes.matchAll(/Revision Note \(([^)]+)\): (.+?)(?=\n\n|$)/g);
    for (const m of matches) {
      revisionHistory.push({ note: m[2], by: "Revision Author", at: m[1] });
    }
  }
  return {
    id: row.id,
    title: row.title,
    stage: row.stage,
    platforms: row.platforms || [],
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
    createdAt: row.created_at?.split("T")[0] || new Date().toISOString().split("T")[0],
    updatedAt: row.updated_at?.split("T")[0] || new Date().toISOString().split("T")[0],
  };
}

function cardToDb(card: Partial<ContentCard> & { id?: string }) {
  const obj: any = {};
  if (card.title !== undefined) obj.title = card.title;
  if (card.stage !== undefined) obj.stage = card.stage;
  if (card.platforms !== undefined) obj.platforms = card.platforms;
  if (card.contentType !== undefined) obj.content_type = card.contentType;
  if (card.thumbnailUrl !== undefined) obj.thumbnail_url = card.thumbnailUrl;
  if (card.scheduledDate !== undefined) obj.scheduled_date = card.scheduledDate || null;
  if (card.scheduledTime !== undefined) obj.scheduled_time = card.scheduledTime || null;
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
          const { data, error } = await supabase.from("posts").select("*").order("created_at", { ascending: false });
          if (!error && data && data.length > 0) {
            setCards(data.map(dbToCard));
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
          const newCard = dbToCard(payload.new);
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
          const updated = dbToCard(payload.new);
          // Skip if this was our own update (dedup)
          if (recentMutations.current.has(updated.id)) return;
          setCards((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
          // Also update selectedCard if it's the same post
          setSelectedCard((prev) => (prev?.id === updated.id ? updated : prev));
        }
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "posts" },
        (payload) => {
          const deletedId = (payload.old as any)?.id;
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
    if (useSupabase) {
      markMutation(cardId);
      supabase.from("posts").update({ stage: newStage }).eq("id", cardId).then(({ error }) => {
        if (error) {
          console.error("[pipeline] stage_change failed:", error.message);
          // Rollback
          setCards((prev) => prev.map((c) => c.id === cardId ? { ...c, stage: fromStage as PipelineStage } : c));
          setSelectedCard((prev) => prev?.id === cardId ? { ...prev, stage: fromStage as PipelineStage } : prev);
        }
      });
    }
    logAudit(cardId, currentUser.name, "stage_change", `Moved from ${fromLabel} to ${toLabel}`);
  }, [useSupabase, cards]);

  const requestReapproval = useCallback((cardId: string) => {
    const card = cards.find((c) => c.id === cardId);
    if (card) setPendingReapproval({ cardId, cardTitle: card.title });
  }, [cards]);

  const submitReapproval = useCallback((cardId: string, note: string) => {
    const now = new Date();
    const timestamp = now.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    const author = currentUser.name;
    const historyEntry = { note, by: author, at: now.toISOString() };
    const noteLine = `Revision Note (${timestamp}): ${note}`;

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

    if (useSupabase) {
      markMutation(cardId);
      const card = cards.find((c) => c.id === cardId);
      const notes = card?.notes ? card.notes + "\n\n" + noteLine : noteLine;
      supabase.from("posts").update({ stage: "awaiting_approval", notes }).eq("id", cardId).then(({ error }) => {
        if (error) console.error("[pipeline] reapproval sync failed:", error.message);
      });
    }

    setPendingReapproval(null);
    logAudit(cardId, author, "revision_submitted", `Fix submitted: ${note}`);
  }, [useSupabase, cards]);

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

    if (useSupabase) {
      markMutation(cardId);
      const card = cards.find((c) => c.id === cardId);
      const notes = card?.notes ? card.notes + "\n\n" + noteLine : noteLine;
      supabase.from("posts").update({ stage: "revision_needed", notes }).eq("id", cardId).then(({ error }) => {
        if (error) console.error("[pipeline] kickback sync failed:", error.message);
      });
    }

    setPendingKickback(null);
    logAudit(cardId, author, "revision_requested", `Kickback: ${note}`);
  }, [useSupabase, cards]);

  const cancelKickback = useCallback(() => {
    setPendingKickback(null);
  }, []);

  const updateCard = useCallback((cardId: string, updates: Partial<ContentCard>) => {
    setCards((prev) => prev.map((c) => (c.id === cardId ? { ...c, ...updates } : c)));
    setSelectedCard((prev) => (prev?.id === cardId ? { ...prev, ...updates } : prev));
    if (useSupabase) {
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
      supabase.from("posts").insert(dbRow).select().single().then(({ data, error }) => {
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
    if (useSupabase) {
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
