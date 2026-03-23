"use client";

import { ExternalLink, FileText, Play, Image as ImageIcon } from "lucide-react";

const URL_REGEX = /(https?:\/\/[^\s<>"{}|\\^`[\]]+)/g;
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
  try {
    const path = new URL(url, "https://x.com").pathname;
    const name = path.split("/").pop() || "file";
    return decodeURIComponent(name);
  } catch {
    return "file";
  }
}

interface Props {
  text: string;
  className?: string;
}

export function RichComment({ text, className = "" }: Props) {
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  const regex = new RegExp(URL_REGEX.source, "g");
  let key = 0;

  while ((match = regex.exec(text)) !== null) {
    // Text before the URL
    if (match.index > lastIndex) {
      parts.push(<span key={key++}>{text.slice(lastIndex, match.index)}</span>);
    }

    const url = match[1];
    const type = getUrlType(url);

    if (type === "image") {
      parts.push(
        <a key={key++} href={url} target="_blank" rel="noopener noreferrer" className="block mt-2 mb-1">
          <img src={url} alt="Attachment" className="max-w-full max-h-[200px] rounded-lg border border-gray-200/60 dark:border-white/[0.06] object-cover shadow-sm hover:shadow-md transition-shadow" />
        </a>
      );
    } else if (type === "video") {
      parts.push(
        <a key={key++} href={url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 mt-2 mb-1 px-3 py-2.5 rounded-lg bg-gray-900 dark:bg-white/[0.06] border border-gray-800 dark:border-white/[0.08] hover:bg-gray-800 dark:hover:bg-white/[0.08] transition-colors">
          <div className="w-9 h-9 rounded-lg bg-violet-500/20 flex items-center justify-center shrink-0">
            <Play className="w-4 h-4 text-violet-400" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-medium text-white dark:text-gray-200 truncate">{getFileName(url)}</p>
            <p className="text-[9px] text-gray-400">Video attachment</p>
          </div>
          <ExternalLink className="w-3 h-3 text-gray-500 shrink-0" />
        </a>
      );
    } else if (type === "document") {
      parts.push(
        <a key={key++} href={url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 mt-2 mb-1 px-3 py-2.5 rounded-lg bg-slate-50 dark:bg-white/[0.03] border border-gray-200 dark:border-white/[0.06] hover:border-orange-200 dark:hover:border-orange-500/20 transition-colors">
          <div className="w-9 h-9 rounded-lg bg-orange-50 dark:bg-orange-500/10 flex items-center justify-center shrink-0">
            <FileText className="w-4 h-4 text-orange-500" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-medium text-gray-700 dark:text-gray-300 truncate">{getFileName(url)}</p>
            <p className="text-[9px] text-gray-400">Document</p>
          </div>
          <ExternalLink className="w-3 h-3 text-gray-400 shrink-0" />
        </a>
      );
    } else {
      parts.push(
        <a key={key++} href={url} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300 underline underline-offset-2 break-all">
          {url.length > 50 ? url.slice(0, 50) + "..." : url}
        </a>
      );
    }

    lastIndex = regex.lastIndex;
  }

  // Remaining text after last URL
  if (lastIndex < text.length) {
    parts.push(<span key={key++}>{text.slice(lastIndex)}</span>);
  }

  // No URLs found — return plain text
  if (parts.length === 0) {
    return <p className={className}>{text}</p>;
  }

  return <div className={className}>{parts}</div>;
}
