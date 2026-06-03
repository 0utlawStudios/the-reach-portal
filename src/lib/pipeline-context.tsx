"use client";

import { createContext, useContext, useState, useCallback, useMemo, useEffect, useRef, ReactNode } from "react";
import { ContentCard, PipelineStage, DEFAULT_CHECKLIST, PIPELINE_COLUMNS, isPlatform } from "./types";
import { PLACEHOLDER_CARDS } from "./placeholder-data";
import { loadState, saveState } from "./persistence";
import { supabase } from "./supabaseClient";
import { logAudit } from "./audit";
import { useAuth } from "./auth-context";
import { useToast } from "./toast-context";
import { APP_TIMEZONE, formatDateTimeCompact, isValidUuid } from "./utils";

// Real @mention pattern — @username form, not any "@" character. Avoids
// false-positive mention notifications on pasted emails or URLs containing "@".
const MENTION_RE = /@[a-zA-Z][\w.-]*/;

const STORAGE_KEY = "pipeline_cards";
const BASELINE_WORKSPACE_ID = "00000000-0000-0000-0000-000000000001";
const POSTS_SELECT_FULL = "*, publish_jobs(state, platform_publish_attempts(platform, state, external_post_id))";
const POSTS_SELECT_BASIC = "*";

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

export type PostRow = {
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
  posted_at?: string | null;
  posted_urls?: Record<string, string> | null;
  // ─── Creator Studio AI fields ───
  feel?: string | null;
  visual_style?: string | null;
  style_prompt?: string | null;
  slides_count?: number | null;
  media_type?: ContentCard["mediaType"] | null;
  aspect_ratio?: ContentCard["aspectRatio"] | null;
  asset_width?: number | null;
  asset_height?: number | null;
  asset_urls?: string[] | null;
  asset_storage_keys?: string[] | null;
  hashtags?: string[] | null;
  cta?: string | null;
  visual_brief?: string | null;
  carousel_outline?: ContentCard["carouselOutline"] | null;
  source_notes?: string[] | null;
  quality_score?: number | null;
  approval_notes?: string | null;
  generated_by_model?: string | null;
  prompt_version?: string | null;
  revision_count?: number | null;
  plan_row_id?: string | null;
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

export function normalizePublishJob(raw: PostRow["publish_jobs"]): ContentCard["publishJob"] | undefined {
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

/** Convert a user-entered date+time (in APP_TIMEZONE) to a UTC ISO string. */
export function toScheduledAt(date?: string, time?: string): string | null | undefined {
  if (date === undefined && time === undefined) return undefined;
  if (!date || !time) return null;

  try {
    // Build a reference Date in UTC (we'll correct for timezone offset below)
    const naive = new Date(`${date}T${time}:00Z`);
    if (Number.isNaN(naive.getTime())) return null;

    // Calculate the UTC offset for APP_TIMEZONE at the naive date.
    // toLocaleString gives us the wall-clock time in that timezone; the diff
    // between the two wall-clock interpretations is the offset in ms.
    const utcWall = new Date(naive.toLocaleString("en-US", { timeZone: "UTC" }));
    const tzWall  = new Date(naive.toLocaleString("en-US", { timeZone: APP_TIMEZONE }));
    const offsetMs = utcWall.getTime() - tzWall.getTime();

    const corrected = new Date(naive.getTime() + offsetMs);
    if (Number.isNaN(corrected.getTime())) return null;
    return corrected.toISOString();
  } catch {
    return null;
  }
}

export function dbToCard(row: PostRow): ContentCard {
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
    postedAt: row.posted_at || undefined,
    postedUrls: row.posted_urls || undefined,
    feel: row.feel || undefined,
    visualStyle: row.visual_style || undefined,
    stylePrompt: row.style_prompt || undefined,
    slidesCount: row.slides_count ?? undefined,
    mediaType: row.media_type || undefined,
    aspectRatio: row.aspect_ratio || undefined,
    assetWidth: row.asset_width ?? undefined,
    assetHeight: row.asset_height ?? undefined,
    assetUrls: row.asset_urls && row.asset_urls.length > 0 ? row.asset_urls : undefined,
    assetStorageKeys: row.asset_storage_keys && row.asset_storage_keys.length > 0 ? row.asset_storage_keys : undefined,
    hashtags: row.hashtags && row.hashtags.length > 0 ? row.hashtags : undefined,
    cta: row.cta || undefined,
    visualBrief: row.visual_brief || undefined,
    carouselOutline: row.carousel_outline || undefined,
    sourceNotes: row.source_notes && row.source_notes.length > 0 ? row.source_notes : undefined,
    qualityScore: row.quality_score ?? undefined,
    approvalNotes: row.approval_notes || undefined,
    generatedByModel: row.generated_by_model || undefined,
    promptVersion: row.prompt_version || undefined,
    revisionCount: row.revision_count ?? undefined,
    planRowId: row.plan_row_id || undefined,
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

export { cardToDb };

/**
 * Iron-law §1b resolver for the initial board load. An empty array is a VALID
 * empty board ("no posts yet") and must render as such. The localStorage
 * backup is read ONLY when the DB returned a real error — never on an empty
 * result. Extracted as a pure function so the guard can be unit-tested
 * directly without mounting the whole provider.
 */
export function resolveLoadedCards(
  result: { error: unknown; data: PostRow[] | null },
  fallback: () => ContentCard[],
): ContentCard[] {
  if (!result.error && result.data) return result.data.map(dbToCard);
  return fallback();
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
  isLoading: boolean;
  selectedCard: ContentCard | null;
  isDrawerOpen: boolean;
  isEditingOnOpen: boolean;
  pendingReapproval: PendingReapproval | null;
  pendingKickback: PendingKickback | null;
  workspaceId: string;
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
  updateCard: (cardId: string, updates: Partial<ContentCard>, onResult?: (persisted: boolean) => void) => void;
  createCard: (card: Partial<Pick<ContentCard, "checklist">> & Omit<ContentCard, "id" | "createdAt" | "updatedAt" | "checklist">) => void;
  deleteCard: (cardId: string) => void;
}

const PipelineContext = createContext<PipelineContextType | null>(null);

export function PipelineProvider({ children }: { children: ReactNode }) {
  const { currentUser, accessToken, provisionResult } = useAuth();
  const { addToast } = useToast();
  const [cards, setCards] = useState<ContentCard[]>(PLACEHOLDER_CARDS);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedCard, setSelectedCard] = useState<ContentCard | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [isEditingOnOpen, setIsEditingOnOpen] = useState(false);
  const [pendingReapproval, setPendingReapproval] = useState<PendingReapproval | null>(null);
  const [pendingKickback, setPendingKickback] = useState<PendingKickback | null>(null);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const hydrated = useRef(false);
  const postsSelect = useRef(POSTS_SELECT_FULL);
  const workspaceIdRef = useRef<string | null>(null);
  const useSupabase = isSupabaseConfigured();

  // Latest-value ref: lets the action callbacks read the current cards array
  // without listing `cards` in their dependency arrays, which keeps their
  // identity (and thus the context value) stable across card mutations
  // (PERF-007). Assigned every render so it is never stale.
  const cardsRef = useRef<ContentCard[]>(cards);
  cardsRef.current = cards;

  // Pending debounced localStorage backup write (PERF-002).
  const backupTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Track local mutations to prevent realtime echo (dedup).
  // TTL bumped from 2000 → 10000ms because realtime fanout can lag past 2s
  // under load, leading to the local mutator double-applying its own change
  // (e.g. an INSERT echo arriving after the dedup window expires).
  const recentMutations = useRef<Set<string>>(new Set());
  const markMutation = (id: string) => {
    recentMutations.current.add(id);
    setTimeout(() => recentMutations.current.delete(id), 10000);
  };

  const activeWorkspaceId = workspaceId || BASELINE_WORKSPACE_ID;

  const postNotification = useCallback(async (path: string, body: Record<string, unknown>) => {
    const token = accessToken || (await supabase.auth.getSession()).data.session?.access_token;
    const headers: HeadersInit = { "Content-Type": "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(path, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`${path} failed with HTTP ${res.status}${detail ? `: ${detail.slice(0, 220)}` : ""}`);
    }
  }, [accessToken]);

  // ─── Initial data load ───
  useEffect(() => {
    async function load() {
      if (useSupabase) {
        try {
          // Resolve workspace + auto-provision membership if missing (breaks RLS chicken-and-egg).
          // provisionResult is pre-fetched by AuthProvider during init (runs in parallel with
          // enrichFromTeamMembers), so by the time we get here it's already available.
          try {
            if (provisionResult?.workspaceId) {
              workspaceIdRef.current = provisionResult.workspaceId;
              setWorkspaceId(provisionResult.workspaceId);
            } else {
              // Fallback: provision wasn't pre-fetched (e.g. first login), fetch now
              const token = accessToken || (await supabase.auth.getSession()).data.session?.access_token;
              if (token) {
                const res = await fetch("/api/workspace/provision", {
                  headers: { Authorization: `Bearer ${token}` },
                });
                if (res.ok) {
                  const json = await res.json();
                  if (json.workspaceId) {
                    workspaceIdRef.current = json.workspaceId;
                    setWorkspaceId(json.workspaceId);
                  }
                }
              }
            }
          } catch { /* continue — workspace_id fallback applies on insert */ }
          if (!workspaceIdRef.current) {
            workspaceIdRef.current = BASELINE_WORKSPACE_ID;
            setWorkspaceId(BASELINE_WORKSPACE_ID);
          }

          // Try full select (with publish_jobs join); fall back if tables missing
          let result = await supabase.from("posts").select(POSTS_SELECT_FULL).order("created_at", { ascending: false });
          if (result.error) {
            postsSelect.current = POSTS_SELECT_BASIC;
            result = await supabase.from("posts").select(POSTS_SELECT_BASIC).order("created_at", { ascending: false });
          }
          // Iron-law §1b: an empty array is a valid empty board. resolveLoadedCards
          // falls back to the localStorage backup ONLY on a real DB error.
          setCards(resolveLoadedCards(result, () => loadState(STORAGE_KEY, PLACEHOLDER_CARDS)));
        } catch {
          setCards(loadState(STORAGE_KEY, PLACEHOLDER_CARDS));
        }
      } else {
        setCards(loadState(STORAGE_KEY, PLACEHOLDER_CARDS));
      }
      hydrated.current = true;
      setIsLoading(false);
    }
    load();
  }, [useSupabase, provisionResult?.workspaceId, accessToken]);

  // ─── Realtime subscription ───
  useEffect(() => {
    if (!useSupabase || !workspaceId) return;

    const wsId = workspaceId;
    const channel = supabase
      .channel(`posts-realtime-${wsId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "posts", filter: `workspace_id=eq.${wsId}` },
        (payload) => {
          const newCard = dbToCard(payload.new as PostRow);
          // Dedup is keyed by tempId + real UUID inside createCard via
          // markMutation; we no longer carry a stale literal "create" key.
          if (recentMutations.current.has(newCard.id)) return;
          setCards((prev) => {
            if (prev.some((c) => c.id === newCard.id)) return prev;
            return [newCard, ...prev];
          });
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "posts", filter: `workspace_id=eq.${wsId}` },
        (payload) => {
          const updated = dbToCard(payload.new as PostRow);
          recentMutations.current.delete(updated.id);
          setCards((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
          // Also update selectedCard if it's the same post
          setSelectedCard((prev) => (prev?.id === updated.id ? updated : prev));
        }
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "posts", filter: `workspace_id=eq.${wsId}` },
        (payload) => {
          const deletedId = (payload.old as Partial<PostRow>).id;
          if (!deletedId) return;
          // A delete is idempotent and authoritative — it is NEVER suppressed
          // via the dedup set. Suppressing a peer's DELETE would leave a card
          // the user can still click, and their next save would target a row
          // that no longer exists (DATA-010). Removing an already-absent card
          // is a harmless no-op, so applying our own echo is safe too.
          setCards((prev) => prev.filter((c) => c.id !== deletedId));
          setSelectedCard((prev) => (prev?.id === deletedId ? null : prev));
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [useSupabase, workspaceId]);

  // ─── Persist localStorage backup (debounced) ───
  // localStorage is only a fallback read when a DB load errors, so a sub-second
  // write delay is harmless. Debouncing avoids a synchronous full-board
  // JSON.stringify on every keystroke and every realtime echo (PERF-002).
  useEffect(() => {
    if (!hydrated.current) return;
    if (backupTimer.current) clearTimeout(backupTimer.current);
    backupTimer.current = setTimeout(() => {
      saveState(STORAGE_KEY, cards);
      backupTimer.current = null;
    }, 800);
  }, [cards]);

  // Flush a pending backup on unmount so the last change is not lost.
  useEffect(() => {
    return () => {
      if (backupTimer.current) {
        clearTimeout(backupTimer.current);
        if (hydrated.current) saveState(STORAGE_KEY, cardsRef.current);
      }
    };
  }, []);

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
    // POSTED LOCKDOWN: only the n8n auto-publisher (service-role) writes
    // stage='posted'. The DB has a BEFORE UPDATE trigger that rejects this
    // path; we short-circuit here so the user sees a useful toast instead
    // of a confusing 400 error.
    if (newStage === "posted") {
      addToast(
        "Only the auto-publisher moves cards to Posted. The card will move automatically once n8n confirms the post is live.",
        "warning",
      );
      return;
    }

    // TEMP-ID GUARD: the card's createCard INSERT is still in flight (its id
    // is a timestamp, not a UUID). Applying a stage move now would be lost —
    // the in-flight INSERT carries the card's original stage. Reject so the
    // user retries once the post has a real id (DATA-004).
    if (useSupabase && !isValidUuid(cardId)) {
      addToast("Still saving this post. Try moving it again in a moment.", "warning");
      return;
    }

    // INTERCEPT: revision_needed → awaiting_approval requires a note
    const card = cardsRef.current.find((c) => c.id === cardId);
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
        try {
          const { error } = await supabase.from("posts").update({ stage: newStage }).eq("id", cardId);
          if (error) throw error;
          // Stage move committed — record the audit entry NOW, not before the
          // write. Logging before confirmation produced phantom audit rows on
          // failed moves and an extra RPC on every drag (PERF-001 / DATA-004).
          logAudit(cardId, currentUser.name, "stage_change", `Moved from ${fromLabel} to ${toLabel}`);
        } catch (error) {
          // The stage UPDATE itself failed — nothing committed. Roll local
          // state back and clear the dedup mark so a realtime echo can
          // re-sync the card.
          const message = error instanceof Error ? error.message : String(error);
          console.error("[pipeline] stage_change failed:", message);
          rollback();
          recentMutations.current.delete(cardId);
          addToast(`Move failed: ${message}. Card restored to "${fromLabel}".`, "error");
          return;
        }

        // ── Post-commit side effects ───────────────────────────────────────
        // The stage move is committed and valid. A failure BELOW must NEVER
        // roll the stage back: the publish job is created lazily and the n8n
        // claimer reconciles it, so an approved card with no job yet is a
        // valid state. Rolling the stage back here would silently un-approve
        // the user's card and diverge the board from the DB (DATA-001).
        if (newStage === "approved_scheduled") {
          const hasSchedule = card?.scheduledDate && card?.scheduledTime;
          if (hasSchedule) {
            try {
              await createPublishJob(cardId);
            } catch (jobErr) {
              const m = jobErr instanceof Error ? jobErr.message : String(jobErr);
              console.error("[pipeline] publish job not queued (stage move kept):", m);
              addToast("Approved. The publish job could not be queued yet, it will retry automatically.", "warning");
            }
          }

          postNotification("/api/notifications/approved", {
            postId: cardId,
            postTitle: card?.title || "",
            approvedBy: currentUser.name,
            createdBy: card?.createdBy || "",
          }).catch((e) => console.error("[pipeline] approved notify failed:", e));
        }

        if (newStage === "awaiting_approval") {
          postNotification("/api/notifications/awaiting-approval", {
            postId: cardId,
            postTitle: card?.title || "",
            movedBy: currentUser.name,
            fromStage,
          }).catch((e) => console.error("[pipeline] awaiting-approval notify failed:", e));
        }
      })();
    } else {
      // Local-only mode (no Supabase configured): record the audit locally.
      logAudit(cardId, currentUser.name, "stage_change", `Moved from ${fromLabel} to ${toLabel}`);
    }
  }, [useSupabase, currentUser.name, addToast, postNotification]);

  const requestReapproval = useCallback((cardId: string) => {
    const card = cardsRef.current.find((c) => c.id === cardId);
    if (card) setPendingReapproval({ cardId, cardTitle: card.title });
  }, []);

  const submitReapproval = useCallback((cardId: string, note: string) => {
    const now = new Date();
    const timestamp = formatDateTimeCompact(now);
    const author = currentUser.name;
    const historyEntry = { note, by: author, at: now.toISOString() };
    const noteLine = `${author} (${timestamp}): Fix submitted — ${note}`;

    // Snapshot previous state for rollback if DB write fails.
    const previousCard = cardsRef.current.find((c) => c.id === cardId);
    const previousSelected = selectedCard;

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
      const card = previousCard;
      const notes = card?.notes ? card.notes + "\n\n" + noteLine : noteLine;
      supabase.from("posts").update({ stage: "awaiting_approval", notes }).eq("id", cardId).then(({ error }) => {
        if (error) {
          console.error("[pipeline] reapproval sync failed:", error.message);
          // Rollback local state — DB write failed, so the prior version is canonical.
          if (previousCard) {
            setCards((prev) => prev.map((c) => c.id === cardId ? previousCard : c));
            setSelectedCard(previousSelected);
          }
          // Clear the dedup mark so a realtime echo can re-sync the card (DATA-003).
          recentMutations.current.delete(cardId);
          addToast(`Save failed: ${error.message}. Changes reverted.`, "error");
          return;
        }
        // Only fire the audit + notification once the DB write actually committed.
        // Previously these ran unconditionally, which produced phantom emails (DATA-002).
        logAudit(cardId, author, "revision_submitted", `Fix submitted: ${note}`);
        postNotification("/api/notifications/awaiting-approval", {
          postId: cardId,
          postTitle: card?.title || "",
          movedBy: author,
          fromStage: "revision_needed",
        }).catch((e) => console.error("[pipeline] awaiting-approval notify failed:", e));
      });
    } else {
      // Local-only path (no Supabase configured or temp id): still record audit locally.
      logAudit(cardId, author, "revision_submitted", `Fix submitted: ${note}`);
    }

    setPendingReapproval(null);
  }, [useSupabase, selectedCard, currentUser.name, addToast, postNotification]);

  const cancelReapproval = useCallback(() => {
    setPendingReapproval(null);
  }, []);

  // ─── Kickback flow (Awaiting Approval → Revision Needed) ───

  const requestKickback = useCallback((cardId: string) => {
    if (useSupabase && !isValidUuid(cardId)) {
      addToast("Still saving this post. Try requesting revisions again in a moment.", "warning");
      return;
    }
    const card = cardsRef.current.find((c) => c.id === cardId);
    if (card) setPendingKickback({ cardId, cardTitle: card.title });
  }, [useSupabase, addToast]);

  const submitKickback = useCallback((cardId: string, note: string, attachmentUrl?: string) => {
    if (useSupabase && !isValidUuid(cardId)) {
      addToast("Still saving this post. Try requesting revisions again in a moment.", "warning");
      setPendingKickback(null);
      return;
    }
    const now = new Date();
    const timestamp = formatDateTimeCompact(now);
    const author = currentUser.name;
    // Capture card before state mutation so notification can read title + createdBy
    const card = cardsRef.current.find((c) => c.id === cardId);
    const previousCard = card;
    const previousSelected = selectedCard;
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

    // Pull these once so the success branch below can fire them cleanly.
    const fireNotifications = () => {
      logAudit(cardId, author, "revision_requested", `Kickback: ${note}`);
      // Notify creator + all approvers/creative directors
      postNotification("/api/notifications/revision", {
        postId: cardId,
        postTitle: card?.title ?? "",
        revisionNote: note,
        requestedBy: currentUser.email,
        createdBy: card?.createdBy,
      }).catch((e) => console.error("[pipeline] revision notify failed:", e));

      // Fire @mention notifications if anyone was tagged. Strict regex so we
      // don't trigger on every "@" in arbitrary text (e.g. pasted emails or URLs).
      if (MENTION_RE.test(note)) {
        postNotification("/api/notifications/mention", {
          comment: note,
          postTitle: card?.title ?? "",
          postId: cardId,
          authorName: currentUser.name,
          authorEmail: currentUser.email,
        }).catch((e) => console.error("[pipeline] mention notify failed:", e));
      }
    };

    if (useSupabase && isValidUuid(cardId)) {
      markMutation(cardId);
      const notes = card?.notes ? card.notes + "\n\n" + noteLine : noteLine;
      supabase.from("posts").update({ stage: "revision_needed", notes }).eq("id", cardId).then(({ error }) => {
        if (error) {
          console.error("[pipeline] kickback sync failed:", error.message);
          // Rollback local state — DB write failed, so prior version is canonical.
          if (previousCard) {
            setCards((prev) => prev.map((c) => c.id === cardId ? previousCard : c));
            setSelectedCard(previousSelected);
          }
          // Clear the dedup mark so a realtime echo can re-sync the card (DATA-003).
          recentMutations.current.delete(cardId);
          addToast(`Kickback failed: ${error.message}. Changes reverted.`, "error");
          return;
        }
        // Only fire audit + notifications + @mention emails on confirmed DB commit.
        // This closes the DATA-002 phantom-email path.
        fireNotifications();
      });
    } else {
      // Local-only path: no DB to confirm, so fire audit + notifications now.
      fireNotifications();
    }

    setPendingKickback(null);
  }, [useSupabase, selectedCard, currentUser.name, currentUser.email, addToast, postNotification]);

  const cancelKickback = useCallback(() => {
    setPendingKickback(null);
  }, []);

  const updateCard = useCallback((cardId: string, updates: Partial<ContentCard>, onResult?: (persisted: boolean) => void) => {
    // Snapshot pre-mutation state so we can fully restore on DB failure.
    // Iron-law spirit: a save that fails silently leaves the user looking at
    // a card that will revert on the next refresh. Mirror moveCard's pattern.
    const previousCard = cardsRef.current.find((c) => c.id === cardId);
    const previousSelected = selectedCard;

    setCards((prev) => prev.map((c) => (c.id === cardId ? { ...c, ...updates } : c)));
    setSelectedCard((prev) => (prev?.id === cardId ? { ...prev, ...updates } : prev));
    if (useSupabase && isValidUuid(cardId)) {
      markMutation(cardId);
      supabase.from("posts").update(cardToDb(updates)).eq("id", cardId).then(({ error }) => {
        if (error) {
          console.error("[pipeline] updateCard sync failed:", error.message);
          if (previousCard) {
            setCards((prev) => prev.map((c) => c.id === cardId ? previousCard : c));
            setSelectedCard(previousSelected);
          }
          // Clear the dedup mark so a realtime echo can re-sync the card (DATA-003).
          recentMutations.current.delete(cardId);
          addToast(`Save failed: ${error.message}. Changes reverted.`, "error");
          onResult?.(false);
        } else {
          // The write committed — callers gating a side-effect (e.g. an
          // @mention email) on a confirmed persist can safely fire now.
          onResult?.(true);
        }
      });
    } else {
      // No DB write happened (local-only mode or a temp-id card mid-create).
      // Report not-persisted so callers do not fire persistence-gated effects.
      onResult?.(false);
    }
  }, [useSupabase, selectedCard, addToast]);

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
      // Mark by tempId so we can match the real insert when it echoes back via
      // realtime. The previous literal "create" key collided across concurrent
      // creators — two simultaneous inserts would each suppress the other's
      // echo until the 2s dedup window expired.
      markMutation(tempId);
      const dbRow = cardToDb(newCard);
      dbRow.checklist = newCard.checklist;
      const insertRow: Record<string, unknown> = { ...dbRow };
      insertRow.workspace_id = workspaceIdRef.current || "00000000-0000-0000-0000-000000000001";
      supabase.from("posts").insert(insertRow).select().single().then(({ data, error }) => {
        if (error) {
          console.error("[pipeline] createCard sync failed:", error.message);
          // Rollback: the row was never persisted, so remove the local tempId
          // card to keep UI honest. Surface the failure to the user.
          setCards((prev) => prev.filter((c) => c.id !== tempId));
          recentMutations.current.delete(tempId);
          addToast(`Save failed: ${error.message}. Card was not created.`, "error");
        } else if (data) {
          const savedCard = dbToCard(data as PostRow);
          setCards((prev) => {
            let inserted = false;
            const next: ContentCard[] = [];
            for (const existing of prev) {
              if (existing.id === tempId || existing.id === savedCard.id) {
                if (!inserted) {
                  next.push(savedCard);
                  inserted = true;
                }
                continue;
              }
              next.push(existing);
            }
            return inserted ? next : [savedCard, ...next];
          });
          // Remap an open drawer's selectedCard from the temp id to the real
          // UUID too. Without this, every subsequent save from that drawer
          // fails the isValidUuid guard and is silently skipped (DATA-005).
          setSelectedCard((prev) => (prev?.id === tempId || prev?.id === savedCard.id ? savedCard : prev));
          // Also mark the real id so the realtime INSERT echo (which will
          // arrive with the real UUID) is suppressed.
          recentMutations.current.delete(tempId);
          markMutation(savedCard.id);
        }
      });
    }
  }, [useSupabase, addToast]);

  const deleteCard = useCallback((cardId: string) => {
    // Snapshot the card BEFORE removing it so we can restore on DB failure.
    // Iron law spirit: a post must never appear to vanish, then quietly come
    // back on refresh. If the 0015 trigger blocks the delete (approved_scheduled
    // / posted), we surface the error and re-insert the card locally.
    const previousCard = cardsRef.current.find((c) => c.id === cardId);
    const previousSelected = selectedCard;
    setCards((prev) => prev.filter((c) => c.id !== cardId));
    setSelectedCard((prev) => (prev?.id === cardId ? null : prev));
    setIsDrawerOpen((open) => {
      if (selectedCard?.id === cardId) return false;
      return open;
    });
    if (useSupabase && isValidUuid(cardId)) {
      markMutation(cardId);
      supabase.from("posts").delete().eq("id", cardId).then(({ error }) => {
        if (error) {
          console.error("[pipeline] deleteCard sync failed:", error.message);
          // Restore the card — DB rejected the delete (RLS or protect-trigger).
          if (previousCard) {
            setCards((prev) => prev.some((c) => c.id === cardId) ? prev : [previousCard, ...prev]);
            setSelectedCard(previousSelected);
            // The card is back on the board — reopen the drawer the user
            // deleted from so it does not silently vanish along with the
            // failed delete (DATA-006).
            if (previousSelected?.id === cardId) setIsDrawerOpen(true);
            // Clear the dedup mark so a realtime echo can re-sync the card.
            recentMutations.current.delete(cardId);
            const isProtected = /protected|approved|posted|cannot.*delete/i.test(error.message);
            addToast(
              isProtected
                ? "This post is locked because it has been approved or posted. Move it back to Revision Needed first."
                : `Delete failed: ${error.message}. Card restored.`,
              "error",
            );
          } else {
            addToast(`Delete failed: ${error.message}.`, "error");
          }
        }
      });
    }
  }, [selectedCard, useSupabase, addToast]);

  const value = useMemo(
    () => ({ cards, isLoading, selectedCard, isDrawerOpen, isEditingOnOpen, pendingReapproval, pendingKickback, workspaceId: activeWorkspaceId, selectCard, selectCardForEditing, closeDrawer, moveCard, requestReapproval, submitReapproval, cancelReapproval, requestKickback, submitKickback, cancelKickback, updateCard, createCard, deleteCard }),
    [cards, isLoading, selectedCard, isDrawerOpen, isEditingOnOpen, pendingReapproval, pendingKickback, activeWorkspaceId, selectCard, selectCardForEditing, closeDrawer, moveCard, requestReapproval, submitReapproval, cancelReapproval, requestKickback, submitKickback, cancelKickback, updateCard, createCard, deleteCard]
  );

  return <PipelineContext.Provider value={value}>{children}</PipelineContext.Provider>;
}

export function usePipeline() {
  const ctx = useContext(PipelineContext);
  if (!ctx) throw new Error("usePipeline must be used within PipelineProvider");
  return ctx;
}
