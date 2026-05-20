"use client";

// Lightweight emoji picker for the support composers. A smiley button opens a
// compact popup grid of ~80 common emojis plus a recents row; tapping one
// inserts it into the textarea at the caret, the way a phone keyboard does.
// Recents persist in localStorage. The popup opens upward so it never clips
// inside the support panel.

import { useState, useRef, useCallback, useEffect } from "react";
import { Smile } from "lucide-react";
import { QUICK_EMOJIS, nextRecents } from "@/lib/support/emoji-data";

const RECENTS_KEY = "support-emoji-recents";

function readRecents(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(RECENTS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((e): e is string => typeof e === "string") : [];
  } catch {
    return [];
  }
}

interface EmojiPickerProps {
  onPick: (emoji: string) => void;
  disabled?: boolean;
}

export function EmojiPicker({ onPick, disabled }: EmojiPickerProps) {
  const [open, setOpen] = useState(false);
  const [recents, setRecents] = useState<string[]>(() => readRecents());
  const wrapRef = useRef<HTMLDivElement>(null);

  // Dismiss on an outside pointer press or Escape, only while open.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const pick = useCallback(
    (emoji: string) => {
      onPick(emoji);
      setRecents((prev) => {
        const next = nextRecents(prev, emoji);
        try {
          window.localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
        } catch {
          /* localStorage unavailable — recents simply won't persist */
        }
        return next;
      });
      setOpen(false);
    },
    [onPick],
  );

  return (
    <div ref={wrapRef} className="relative shrink-0">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        aria-label="Add emoji"
        aria-expanded={open}
        aria-haspopup="dialog"
        className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-orange-500 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-white/[0.06]"
      >
        <Smile className="h-[18px] w-[18px]" />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Emoji picker"
          className="absolute bottom-full left-0 z-20 mb-2 w-[290px] rounded-xl border border-gray-200 bg-white p-2 shadow-xl dark:border-white/10 dark:bg-[#16161a]"
        >
          {recents.length > 0 && (
            <>
              <p className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
                Recent
              </p>
              <div className="grid grid-cols-8 gap-0.5">
                {recents.slice(0, 8).map((e, i) => (
                  <EmojiCell key={`recent-${e}-${i}`} emoji={e} onPick={pick} />
                ))}
              </div>
              <div className="my-1.5 border-t border-gray-100 dark:border-white/[0.06]" />
            </>
          )}
          <div className="grid max-h-[176px] grid-cols-8 gap-0.5 overflow-y-auto">
            {QUICK_EMOJIS.map((e) => (
              <EmojiCell key={e} emoji={e} onPick={pick} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function EmojiCell({ emoji, onPick }: { emoji: string; onPick: (e: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onPick(emoji)}
      aria-label={`Insert ${emoji}`}
      className="flex aspect-square w-full items-center justify-center rounded-md text-[19px] leading-none transition-colors hover:bg-gray-100 dark:hover:bg-white/[0.08]"
    >
      {emoji}
    </button>
  );
}
