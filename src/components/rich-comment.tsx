"use client";

import { useState } from "react";
import { ExternalLink, FileText, Play, Phone, MessageCircle } from "lucide-react";
import { useTeam } from "@/lib/team-context";

const URL_REGEX = /(https?:\/\/[^\s<>"{}|\\^`[\]]+)/g;
const MENTION_REGEX = /@([A-Za-z][A-Za-z\s]*?)(?=\s@|\s*$|[.,!?;:\n])/g;
const IMAGE_EXT = /\.(png|jpg|jpeg|gif|webp|svg)(\?|$)/i;
const VIDEO_EXT = /\.(mp4|mov|webm|avi|mkv)(\?|$)/i;
const DOC_EXT = /\.(pdf|txt|doc|docx|xls|xlsx|ppt|pptx)(\?|$)/i;
const DRIVE_STREAM = /\/api\/drive\/stream\?id=/;

function getUrlType(url: string): "image" | "video" | "document" | "link" {
  if (IMAGE_EXT.test(url) || (DRIVE_STREAM.test(url) && !VIDEO_EXT.test(url) && !DOC_EXT.test(url))) return "image";
  if (VIDEO_EXT.test(url)) return "video";
  if (DOC_EXT.test(url)) return "document";
  return "link";
}

function getFileName(url: string): string {
  try { return decodeURIComponent(new URL(url, "https://x.com").pathname.split("/").pop() || "file"); }
  catch { return "file"; }
}

// Mention popup
function MentionBadge({ name }: { name: string }) {
  const { members } = useTeam();
  const [showPopup, setShowPopup] = useState(false);
  const member = members.find((m) => m.name.toLowerCase() === name.toLowerCase().trim());

  return (
    <span className="relative inline-block">
      <button
        onClick={() => setShowPopup(!showPopup)}
        className="font-bold text-orange-600 dark:text-orange-400 hover:text-orange-700 dark:hover:text-orange-300 cursor-pointer transition-colors"
      >
        @{name.trim()}
      </button>
      {showPopup && member && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setShowPopup(false)} />
          <div className="absolute left-0 bottom-full mb-2 z-50 w-[240px] bg-white dark:bg-[#1a1a1e] rounded-xl border border-gray-200 dark:border-white/[0.1] shadow-xl p-4 space-y-3 animate-in fade-in zoom-in-95 duration-150">
            {/* Avatar + name */}
            <div className="flex items-center gap-3">
              {member.avatar ? (
                <img src={member.avatar} alt={member.name} className="w-10 h-10 rounded-full object-cover" />
              ) : (
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-[12px] font-bold text-white">
                  {member.name.split(" ").map((n) => n[0]).join("").slice(0, 2)}
                </div>
              )}
              <div>
                <p className="text-[13px] font-semibold text-gray-800 dark:text-gray-200">{member.name}</p>
                <p className="text-[10px] text-gray-400 capitalize">{member.role.replace(/_/g, " ")}</p>
              </div>
            </div>

            {/* Contact actions */}
            <div className="flex gap-1.5">
              <a href={member.phone ? `https://wa.me/${member.phone.replace(/[^0-9]/g, "")}` : `mailto:${member.email}`} target="_blank" rel="noopener noreferrer"
                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-500/15 transition-colors cursor-pointer">
                <MessageCircle className="w-3.5 h-3.5" />
                <span className="text-[11px] font-medium">Message</span>
              </a>
              <a href={member.phone ? `tel:${member.phone}` : `mailto:${member.email}`}
                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/20 text-blue-700 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-500/15 transition-colors cursor-pointer">
                <Phone className="w-3.5 h-3.5" />
                <span className="text-[11px] font-medium">Call</span>
              </a>
            </div>
            {member.phone && (
              <p className="text-[10px] text-gray-400 font-mono text-center">{member.phone}</p>
            )}
            <p className="text-[10px] text-gray-400 text-center">{member.email}</p>
          </div>
        </>
      )}
    </span>
  );
}

interface Props {
  text: string;
  className?: string;
}

export function RichComment({ text, className = "" }: Props) {
  // First pass: split by URLs and mentions into segments
  const segments: { type: "text" | "url" | "mention"; value: string }[] = [];
  let remaining = text;

  // Combined regex for URLs and mentions
  // Match @FirstName LastName (exactly 2-3 capitalized words) or URLs
  const combined = /(@[A-Z][a-z]+(?:\s[A-Z][a-z]+){0,2})|(https?:\/\/[^\s<>"{}|\\^`[\]]+)/g;
  let lastIdx = 0;
  let match: RegExpExecArray | null;
  const combinedRegex = new RegExp(combined.source, "g");

  while ((match = combinedRegex.exec(text)) !== null) {
    if (match.index > lastIdx) {
      segments.push({ type: "text", value: text.slice(lastIdx, match.index) });
    }
    if (match[1]) {
      segments.push({ type: "mention", value: match[1].slice(1).trim() }); // Remove @
    } else if (match[2]) {
      segments.push({ type: "url", value: match[2] });
    }
    lastIdx = combinedRegex.lastIndex;
  }
  if (lastIdx < text.length) {
    segments.push({ type: "text", value: text.slice(lastIdx) });
  }

  if (segments.length === 0) {
    return <p className={className}>{text}</p>;
  }

  return (
    <div className={className}>
      {segments.map((seg, i) => {
        if (seg.type === "text") return <span key={i}>{seg.value}</span>;

        if (seg.type === "mention") {
          return <MentionBadge key={i} name={seg.value} />;
        }

        // URL rendering
        const url = seg.value;
        const type = getUrlType(url);

        if (type === "image") {
          return (
            <a key={i} href={url} target="_blank" rel="noopener noreferrer" className="block mt-2 mb-1">
              <img src={url} alt="Attachment" className="max-w-full max-h-[200px] rounded-lg border border-gray-200/60 dark:border-white/[0.06] object-cover shadow-sm hover:shadow-md transition-shadow" />
            </a>
          );
        }
        if (type === "video") {
          return (
            <a key={i} href={url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 mt-2 mb-1 px-3 py-2.5 rounded-lg bg-gray-900 dark:bg-white/[0.06] border border-gray-800 dark:border-white/[0.08] hover:bg-gray-800 transition-colors">
              <div className="w-9 h-9 rounded-lg bg-violet-500/20 flex items-center justify-center shrink-0"><Play className="w-4 h-4 text-violet-400" /></div>
              <div className="flex-1 min-w-0"><p className="text-[11px] font-medium text-white truncate">{getFileName(url)}</p><p className="text-[9px] text-gray-400">Video</p></div>
              <ExternalLink className="w-3 h-3 text-gray-500 shrink-0" />
            </a>
          );
        }
        if (type === "document") {
          return (
            <a key={i} href={url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 mt-2 mb-1 px-3 py-2.5 rounded-lg bg-slate-50 dark:bg-white/[0.03] border border-gray-200 dark:border-white/[0.06] hover:border-orange-200 transition-colors">
              <div className="w-9 h-9 rounded-lg bg-orange-50 dark:bg-orange-500/10 flex items-center justify-center shrink-0"><FileText className="w-4 h-4 text-orange-500" /></div>
              <div className="flex-1 min-w-0"><p className="text-[11px] font-medium text-gray-700 dark:text-gray-300 truncate">{getFileName(url)}</p><p className="text-[9px] text-gray-400">Document</p></div>
              <ExternalLink className="w-3 h-3 text-gray-400 shrink-0" />
            </a>
          );
        }
        return (
          <a key={i} href={url} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:text-blue-600 dark:text-blue-400 underline underline-offset-2 break-all">
            {url.length > 50 ? url.slice(0, 50) + "..." : url}
          </a>
        );
      })}
    </div>
  );
}
