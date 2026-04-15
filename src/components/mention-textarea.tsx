"use client";

import { RawImage } from "@/components/raw-image";
import { useState, useRef } from "react";
import { useTeam } from "@/lib/team-context";
import { useToast } from "@/lib/toast-context";

interface Props {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  rows?: number;
}

export function MentionTextarea({ value, onChange, placeholder, className, rows = 3 }: Props) {
  const { members } = useTeam();
  const { addToast } = useToast();
  const [showDropdown, setShowDropdown] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const [cursorPos, setCursorPos] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const filteredMembers = members.filter((m) =>
    m.status === "active" && m.name.toLowerCase().includes(mentionQuery.toLowerCase())
  );

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    const pos = e.target.selectionStart || 0;
    onChange(val);
    setCursorPos(pos);

    // Check for @ trigger
    const textBeforeCursor = val.slice(0, pos);
    const atMatch = textBeforeCursor.match(/@([\w\s]*)$/);
    if (atMatch) {
      setMentionQuery(atMatch[1]);
      setShowDropdown(true);
    } else {
      setShowDropdown(false);
    }
  };

  const insertMention = (name: string) => {
    const textBeforeCursor = value.slice(0, cursorPos);
    const atIndex = textBeforeCursor.lastIndexOf("@");
    const before = value.slice(0, atIndex);
    const after = value.slice(cursorPos);
    const newVal = `${before}@${name} ${after}`;
    onChange(newVal);
    setShowDropdown(false);

    // Mention inserted — email will be sent when comment is saved
    addToast(`@${name} will be notified when you post this comment`, "info");

    // Refocus
    setTimeout(() => {
      if (textareaRef.current) {
        const newPos = atIndex + name.length + 2;
        textareaRef.current.focus();
        textareaRef.current.setSelectionRange(newPos, newPos);
      }
    }, 50);
  };

  return (
    <div className="relative">
      <textarea
        ref={textareaRef}
        value={value}
        onChange={handleInput}
        placeholder={placeholder}
        rows={rows}
        className={className}
      />
      {showDropdown && filteredMembers.length > 0 && (
        <div className="absolute left-0 bottom-full mb-1 w-64 max-h-72 overflow-y-auto bg-white dark:bg-[#1a1a1a] rounded-xl border border-gray-200 dark:border-white/[0.1] shadow-xl py-1 z-50">
          <p className="px-3 py-1 text-[9px] font-bold text-gray-400 uppercase tracking-wider">Mention someone</p>
          {filteredMembers.map((member) => (
            <button
              key={member.id}
              onClick={() => insertMention(member.name)}
              className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-gray-50 dark:hover:bg-white/[0.04] transition-colors cursor-pointer text-left"
            >
              {member.avatar ? (
                <RawImage src={member.avatar} alt={member.name} className="w-7 h-7 rounded-full object-cover shrink-0" />
              ) : (
                <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-[9px] font-bold text-white shrink-0">
                  {member.name.split(" ").map((n) => n[0]).join("").slice(0, 2)}
                </div>
              )}
              <div>
                <p className="text-[12px] font-medium text-gray-800 dark:text-gray-200">{member.name}</p>
                <p className="text-[9px] text-gray-400 capitalize">{member.role.replace(/_/g, " ")}</p>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
