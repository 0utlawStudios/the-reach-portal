"use client";

import { useState, useRef, useEffect } from "react";

interface InlineEditProps {
  value: string;
  onSave: (value: string) => void;
  placeholder?: string;
  className?: string;
  inputClassName?: string;
  multiline?: boolean;
  as?: "h2" | "p" | "span";
}

export function InlineEdit({ value, onSave, placeholder = "Click to edit...", className = "", inputClassName = "", multiline = false, as = "p" }: InlineEditProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLTextAreaElement | HTMLInputElement>(null);

  useEffect(() => { setDraft(value); }, [value]);

  useEffect(() => {
    if (editing && ref.current) {
      ref.current.focus();
      if (multiline && ref.current instanceof HTMLTextAreaElement) {
        ref.current.style.height = "auto";
        ref.current.style.height = ref.current.scrollHeight + "px";
      }
    }
  }, [editing, multiline]);

  const handleBlur = () => {
    setEditing(false);
    if (draft.trim() !== value) onSave(draft.trim());
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { setDraft(value); setEditing(false); }
    if (!multiline && e.key === "Enter") { handleBlur(); }
  };

  const autoResize = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setDraft(e.target.value);
    e.target.style.height = "auto";
    e.target.style.height = e.target.scrollHeight + "px";
  };

  if (editing) {
    const sharedClass = `w-full bg-white dark:bg-white/[0.04] border border-blue-300 dark:border-blue-500/40 rounded-lg px-3 py-2 outline-none ring-2 ring-blue-100 dark:ring-blue-500/20 transition-all duration-150 ${inputClassName}`;

    if (multiline) {
      return (
        <textarea
          ref={ref as React.RefObject<HTMLTextAreaElement>}
          value={draft}
          onChange={autoResize}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          className={`${sharedClass} resize-none overflow-hidden`}
          rows={1}
        />
      );
    }
    return (
      <input
        ref={ref as React.RefObject<HTMLInputElement>}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        className={sharedClass}
      />
    );
  }

  const Tag = as;
  const isEmpty = !value || !value.trim();

  return (
    <Tag
      onClick={() => setEditing(true)}
      role="button"
      tabIndex={0}
      aria-label="Click to edit"
      onKeyDown={(e: React.KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setEditing(true); } }}
      className={`group cursor-text rounded-lg px-3 py-2 -mx-3 -my-2 transition-all duration-150 hover:bg-gray-50 dark:hover:bg-white/[0.03] hover:ring-1 hover:ring-gray-200 dark:hover:ring-white/[0.08] ${isEmpty ? "text-gray-400 dark:text-gray-500 italic" : ""} ${className}`}
    >
      {isEmpty ? placeholder : value}
    </Tag>
  );
}
