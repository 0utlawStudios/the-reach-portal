"use client";

// "New message" control for the admin Support Inbox. The superadmin clicks it
// to open a live chat with a teammate. It lists active team members (minus the
// superadmin themselves); picking one hands the email up via onPick. The
// server resolves and workspace-scopes that email — this list is only the UI.

import { useState, useRef, useEffect } from "react";
import { Plus, Loader2 } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useTeam } from "@/lib/team-context";

interface RecipientPickerProps {
  onPick: (email: string) => void;
  busy?: boolean;
}

export function RecipientPicker({ onPick, busy }: RecipientPickerProps) {
  const { currentUser } = useAuth();
  const { members } = useTeam();
  const [open, setOpen] = useState(false);
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

  const myEmail = (currentUser.email || "").toLowerCase();
  const recipients = members.filter(
    (m) => m.status === "active" && m.email.toLowerCase() !== myEmail,
  );

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={busy}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex h-9 w-full items-center justify-center gap-1.5 rounded-lg bg-orange-500 text-[12px] font-semibold text-white transition-colors hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {busy ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Plus className="h-3.5 w-3.5" />
        )}
        New message
      </button>

      {open && !busy && (
        <div
          role="menu"
          className="absolute left-0 right-0 top-full z-20 mt-1 max-h-64 overflow-y-auto rounded-lg border border-gray-200 bg-white py-1 shadow-xl dark:border-white/10 dark:bg-[#16161a]"
        >
          {recipients.length === 0 ? (
            <p className="px-3 py-3 text-center text-[12px] text-gray-400">
              No teammates to message yet.
            </p>
          ) : (
            recipients.map((m) => (
              <button
                key={m.id}
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  onPick(m.email);
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-gray-50 dark:hover:bg-white/[0.04]"
              >
                <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-gray-900 dark:text-white">
                  {m.name}
                </span>
                <span className="shrink-0 text-[10px] capitalize text-gray-400">
                  {m.role.replace(/_/g, " ")}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
