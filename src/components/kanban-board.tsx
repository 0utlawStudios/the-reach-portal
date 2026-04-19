"use client";

import { RawImage } from "@/components/raw-image";
import { useCallback, useState, useMemo, useEffect } from "react";
import {
  DndContext, DragEndEvent, DragStartEvent, DragOverlay,
  PointerSensor, TouchSensor, useSensor, useSensors, pointerWithin, rectIntersection,
} from "@dnd-kit/core";
import { usePipeline } from "@/lib/pipeline-context";
import { useAuth } from "@/lib/auth-context";
import { useTeam } from "@/lib/team-context";
import { useToast } from "@/lib/toast-context";
import { PIPELINE_COLUMNS, PipelineStage, ContentCard as ContentCardType } from "@/lib/types";
import { PipelineColumn } from "./pipeline-column";
import { ContentCard } from "./content-card";
import { PlatformIcon } from "./platform-icons";
import { createPortal } from "react-dom";
import { Archive, RotateCcw, Calendar } from "lucide-react";
import { RepurposeModal } from "./repurpose-modal";
import { ValidationErrorModal } from "./validation-error-modal";
import { useNavigation } from "@/lib/navigation-context";

// ─── Context-aware sorting per column ───

function sortForColumn(cards: ContentCardType[], stage: PipelineStage): ContentCardType[] {
  return [...cards].sort((a, b) => {
    switch (stage) {
      // Ideas: newest created first (recency)
      case "ideas":
        return b.createdAt.localeCompare(a.createdAt);

      // Active columns: closest upcoming deadline at top, no-date pushed to bottom
      case "awaiting_approval":
      case "revision_needed":
      case "approved_scheduled": {
        if (a.scheduledDate && b.scheduledDate) return a.scheduledDate.localeCompare(b.scheduledDate);
        if (a.scheduledDate && !b.scheduledDate) return -1;
        if (!a.scheduledDate && b.scheduledDate) return 1;
        return b.updatedAt.localeCompare(a.updatedAt);
      }

      // Posted: most recently published at top (reverse chronological)
      case "posted":
        if (a.scheduledDate && b.scheduledDate) return b.scheduledDate.localeCompare(a.scheduledDate);
        if (a.scheduledDate && !b.scheduledDate) return -1;
        if (!a.scheduledDate && b.scheduledDate) return 1;
        return b.updatedAt.localeCompare(a.updatedAt);

      default:
        return 0;
    }
  });
}

// ─── RBAC: columns that require Approver ───
const APPROVER_COLUMNS: PipelineStage[] = ["approved_scheduled", "posted"];

function isApprover(role: string): boolean {
  return ["superadmin", "admin", "approver", "creative_director"].includes(role);
}

export function KanbanBoard() {
  const { cards, moveCard, requestKickback, selectCard } = usePipeline();
  const { currentUser } = useAuth();
  const { members } = useTeam();
  const { addToast } = useToast();
  const { pendingOpenPostId, clearPendingPost } = useNavigation();
  const [activeCard, setActiveCard] = useState<ContentCardType | null>(null);
  const [view, setView] = useState<"pipeline" | "archive">(() => {
    if (typeof window === "undefined") return "pipeline";
    return sessionStorage.getItem("t10_open_archive") === "true" ? "archive" : "pipeline";
  });
  const [repurposingCard, setRepurposingCard] = useState<ContentCardType | null>(null);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
  );

  // ─── Auto-open card from cross-page navigation ───
  useEffect(() => {
    if (!pendingOpenPostId) return;
    const card = cards.find((c) => c.id === pendingOpenPostId);
    if (card) {
      selectCard(card);
      clearPendingPost();
    }
  }, [pendingOpenPostId, cards, selectCard, clearPendingPost]);

  // ─── Auto-open archive view from dashboard link ───
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (sessionStorage.getItem("t10_open_archive") === "true") {
      sessionStorage.removeItem("t10_open_archive");
    }
  }, []);

  // Resolve current user's team member record for RBAC
  const currentMember = useMemo(
    () => members.find((m) => m.email === currentUser.email),
    [members, currentUser.email]
  );
  const userIsApprover = useMemo(
    () => currentMember ? isApprover(currentMember.role) : false,
    [currentMember]
  );

  // CST week window (Sun-Sat)
  const thisWeekStart = useMemo(() => {
    const now = new Date();
    const cstOffset = -6 * 60;
    const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
    const cstNow = new Date(utcMs + cstOffset * 60000);
    const day = cstNow.getDay();
    const sunday = new Date(cstNow);
    sunday.setDate(cstNow.getDate() - day);
    sunday.setHours(0, 0, 0, 0);
    return sunday;
  }, []);

  const sortedColumnCards = useMemo(() => {
    const map: Record<string, ContentCardType[]> = {};
    PIPELINE_COLUMNS.forEach((col) => {
      let colCards = cards.filter((c) => c.stage === col.id);
      // Posted column only shows this week's posts — older ones auto-archive
      if (col.id === "posted") {
        colCards = colCards.filter((c) => !c.scheduledDate || new Date(c.scheduledDate) >= thisWeekStart);
      }
      map[col.id] = sortForColumn(colCards, col.id);
    });
    return map;
  }, [cards, thisWeekStart]);

  // Archive = posted cards before this week
  const archivedCards = useMemo(() => {
    return cards
      .filter((c) => c.stage === "posted" && c.scheduledDate && new Date(c.scheduledDate) < thisWeekStart)
      .sort((a, b) => (b.scheduledDate || "").localeCompare(a.scheduledDate || ""));
  }, [cards, thisWeekStart]);

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const card = cards.find((c) => c.id === event.active.id);
    if (card) setActiveCard(card);
  }, [cards]);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    setActiveCard(null);
    const { active, over } = event;
    if (!over) return;

    const cardId = active.id as string;
    const overId = over.id as string;
    const sourceCard = cards.find((c) => c.id === cardId);
    if (!sourceCard) return;

    // Determine target stage
    const isColumn = PIPELINE_COLUMNS.some((col) => col.id === overId);
    const targetStage: PipelineStage | undefined = isColumn
      ? (overId as PipelineStage)
      : cards.find((c) => c.id === overId)?.stage;

    if (!targetStage || sourceCard.stage === targetStage) return;

    // ── Completeness gate: required fields must be filled before entering Awaiting Approval, Approved, or Posted ──
    if (sourceCard.stage === "ideas" || targetStage === "awaiting_approval" || targetStage === "approved_scheduled" || targetStage === "posted") {
      const missing: string[] = [];
      if (!sourceCard.scheduledDate) missing.push("scheduled date");
      if (!sourceCard.scheduledTime) missing.push("scheduled time");
      if (!sourceCard.thumbnailUrl) missing.push("thumbnail");
      if (!sourceCard.sourceVault?.rawFiles?.length) missing.push("content for publishing");
      if (!sourceCard.caption?.trim()) missing.push("caption");
      if (!sourceCard.assetSource?.trim()) missing.push("asset source");
      const unchecked = (sourceCard.checklist || []).filter((c) => !c.checked).length;
      if (unchecked > 0) missing.push(`${unchecked} checklist item${unchecked > 1 ? "s" : ""}`);
      if (missing.length > 0) {
        setValidationErrors(missing);
        return;
      }
    }

    // ── RBAC gate: Approver-only columns ──
    if (APPROVER_COLUMNS.includes(targetStage) && !userIsApprover) {
      addToast("Error: Approver permissions required to move cards here.", "error");
      return; // snap back
    }

    // ── Universal gate: ANY card → revision_needed requires feedback ──
    if (targetStage === "revision_needed") {
      requestKickback(cardId);
      return; // modal handles the move after user provides reason
    }

    // ── Fix Submitted: revision_needed → awaiting_approval (modal intercept) ──
    // moveCard() already intercepts this and opens the RevisionModal
    // All other moves go through moveCard() normally
    moveCard(cardId, targetStage);
  }, [cards, moveCard, requestKickback, userIsApprover, addToast]);

  const handleDragOver = useCallback(() => {
    // Empty: all moves on drop. DragOverlay provides visual feedback.
  }, []);

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Tab bar */}
      <div className="flex items-center gap-1 px-4 pt-3 pb-1 shrink-0">
        <button onClick={() => setView("pipeline")}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium transition-colors cursor-pointer ${view === "pipeline" ? "bg-gray-900 text-white dark:bg-white dark:text-gray-900" : "text-gray-400 hover:text-gray-600 hover:bg-gray-50 dark:hover:bg-white/[0.04]"}`}>
          Pipeline
        </button>
        <button onClick={() => setView("archive")}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium transition-colors cursor-pointer ${view === "archive" ? "bg-gray-900 text-white dark:bg-white dark:text-gray-900" : "text-gray-400 hover:text-gray-600 hover:bg-gray-50 dark:hover:bg-white/[0.04]"}`}>
          <Archive className="w-3.5 h-3.5" />
          Archive
          {archivedCards.length > 0 && <span className="ml-1 text-[10px] bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300 px-1.5 rounded-full">{archivedCards.length}</span>}
        </button>
      </div>

      {view === "pipeline" ? (
        <DndContext sensors={sensors} collisionDetection={(args) => {
          const pw = pointerWithin(args);
          if (pw.length > 0) return pw;
          return rectIntersection(args);
        }} onDragStart={handleDragStart} onDragEnd={handleDragEnd} onDragOver={handleDragOver}>
          <div className="flex gap-3 p-4 overflow-x-auto min-h-0 flex-1 snap-x snap-mandatory md:snap-none touch-pan-x">
            {PIPELINE_COLUMNS.map((column) => (
              <PipelineColumn key={column.id} column={column} cards={sortedColumnCards[column.id] || []} />
            ))}
          </div>
          {typeof document !== "undefined" && createPortal(
            <DragOverlay dropAnimation={null}>
              {activeCard && <ContentCard card={activeCard} isDragOverlay />}
            </DragOverlay>,
            document.body
          )}
        </DndContext>
      ) : (
        /* Archive view */
        <div className="flex-1 overflow-y-auto p-4">
          <div className="max-w-[800px] mx-auto text-center">
            <p className="text-[12px] text-gray-400 dark:text-gray-500 mb-6">Posts published before this week (Sun–Sat CST). Repurpose them to create new content.</p>
            {archivedCards.length > 0 ? (
              <div className="space-y-2">
                {archivedCards.map((card) => (
                  <div key={card.id} onClick={() => selectCard(card)} className="flex items-center gap-3 p-3 bg-white dark:bg-[#151518] rounded-xl border border-gray-200/80 dark:border-white/[0.06] shadow-sm hover:shadow-md transition-shadow cursor-pointer">
                    <RawImage src={card.thumbnailUrl} alt="" className="w-16 h-12 rounded-lg object-cover shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-medium text-gray-800 dark:text-gray-200 truncate">{card.title}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <div className="flex items-center gap-1">
                          {card.platforms.map((p) => <span key={p} className="text-gray-400"><PlatformIcon platform={p} className="w-3 h-3" /></span>)}
                        </div>
                        <span className="text-[10px] text-gray-400 flex items-center gap-1"><Calendar className="w-2.5 h-2.5" />Posted {card.scheduledDate}</span>
                      </div>
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); setRepurposingCard(card); }}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 text-[11px] font-medium hover:bg-blue-100 dark:hover:bg-blue-500/20 transition-colors cursor-pointer border border-blue-200 dark:border-blue-500/20"
                    >
                      <RotateCcw className="w-3 h-3" />
                      Repurpose
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-12">
                <Archive className="w-8 h-8 text-gray-300 dark:text-gray-600 mx-auto mb-2" />
                <p className="text-[13px] text-gray-400">No archived posts yet</p>
                <p className="text-[11px] text-gray-300 dark:text-gray-600 mt-1">Posts move here automatically after this week ends</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Repurpose Modal */}
      {repurposingCard && <RepurposeModal card={repurposingCard} onClose={() => setRepurposingCard(null)} />}

      {/* Validation Error Modal */}
      <ValidationErrorModal errors={validationErrors} onClose={() => setValidationErrors([])} />
    </div>
  );
}
