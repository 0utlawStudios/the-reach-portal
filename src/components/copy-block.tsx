"use client";

import { useState } from "react";
import { useToast } from "@/lib/toast-context";
import { Copy, Check } from "lucide-react";

interface CopyBlockProps {
  text: string;
  label?: string;
  className?: string;
  mono?: boolean;
}

export function CopyBlock({ text, label, className = "", mono = false }: CopyBlockProps) {
  const { addToast } = useToast();
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      addToast("Copied to clipboard", "success");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      addToast("Failed to copy", "error");
    }
  };

  return (
    <div className={`group relative ${className}`}>
      {label && <p className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-[0.08em] mb-1.5">{label}</p>}
      <div
        role="button"
        tabIndex={0}
        aria-label={label ? `Copy ${label}` : "Copy to clipboard"}
        onClick={handleCopy}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            handleCopy();
          }
        }}
        className={`reach-copy-card relative bg-gray-50 dark:bg-white/[0.03] border border-gray-200/80 dark:border-white/[0.06] rounded-xl px-4 py-3 pr-12 cursor-pointer hover:border-orange-300 dark:hover:border-orange-500/30 hover:bg-orange-50/30 dark:hover:bg-orange-500/[0.03] focus:outline-none focus:ring-2 focus:ring-orange-400/40 transition-all duration-200 ${mono ? "font-mono" : ""}`}
      >
        <p className={`text-[13px] text-gray-700 dark:text-gray-300 leading-relaxed whitespace-pre-wrap ${mono ? "text-[12px]" : ""}`}>{text}</p>
        <div className={`reach-copy-icon absolute top-3 right-3 w-7 h-7 rounded-lg flex items-center justify-center transition-all duration-200 ${copied ? "bg-orange-100 dark:bg-orange-500/20 text-orange-600" : "bg-gray-100 dark:bg-white/[0.06] text-gray-400 group-hover:text-orange-500 group-hover:bg-orange-100 dark:group-hover:bg-orange-500/10"}`}>
          {copied ? <Check className="w-3.5 h-3.5" aria-hidden="true" /> : <Copy className="w-3.5 h-3.5" aria-hidden="true" />}
        </div>
      </div>
    </div>
  );
}

interface ColorSwatchProps {
  name: string;
  hex: string;
  desc: string;
  role?: string;
  className?: string;
}

export function ColorSwatch({ name, hex, desc, role }: ColorSwatchProps) {
  const { addToast } = useToast();
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(hex);
      setCopied(true);
      addToast(`Copied ${hex}`, "success");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      addToast("Failed to copy", "error");
    }
  };

  return (
    <div onClick={handleCopy} className="cursor-pointer group rounded-2xl overflow-hidden border border-gray-200/80 dark:border-white/[0.06] shadow-sm hover:shadow-lg hover:-translate-y-1 transition-all duration-300 bg-white dark:bg-[#151518]">
      <div className="h-28 relative" style={{ backgroundColor: hex }}>
        <div className={`absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-200 ${copied ? "opacity-100" : ""}`}>
          <div className="w-10 h-10 rounded-full bg-white/90 dark:bg-black/50 flex items-center justify-center shadow-lg">
            {copied ? <Check className="w-4.5 h-4.5 text-orange-600" /> : <Copy className="w-4.5 h-4.5 text-gray-700 dark:text-white" />}
          </div>
        </div>
      </div>
      <div className="p-4">
        <p className="text-[14px] font-semibold text-gray-900 dark:text-white">{name}</p>
        <p className="text-[11px] text-gray-400 mt-0.5">{desc}</p>
        <div className="flex items-center gap-2 mt-2">
          <span className="text-[11px] font-mono font-medium text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-white/[0.06] px-2 py-0.5 rounded">{hex}</span>
          {role && <span className="text-[9px] font-medium text-gray-400 uppercase tracking-wider">{role}</span>}
        </div>
      </div>
    </div>
  );
}
