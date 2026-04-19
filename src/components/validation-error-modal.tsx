"use client";

import { X, AlertTriangle } from "lucide-react";

const FIELD_GUIDANCE: Record<string, string> = {
  "title": "Enter a descriptive title at the top of the form.",
  "content file": "Upload at least one image or video, or browse the Media Library.",
  "platform": "Select one or more target platforms (Facebook, Instagram, etc.).",
  "date": "Set the date this post goes live. Found in the Post Date & Time section.",
  "time": "Set the exact time this post gets published, next to the date field.",
  "scheduled date": "Set the date this post goes live. Click the schedule area in the drawer.",
  "scheduled time": "Set the exact time this post gets published, next to the date picker.",
  "hook": "Describe the attention-grabbing opening (internal only, not posted). What happens in the first 3 seconds?",
  "caption": "Write the full caption text that gets published to social media platforms. Include hashtags and CTAs.",
  "asset source": "Select where the media came from (Envato, Pexels, Shot by Team, etc.).",
  "thumbnail": "Upload or select a cover image for the post card.",
  "content for publishing": "Upload at least one file that n8n will post to social platforms.",
  "design file link": "Go to the Details tab and paste the editable Canva/Figma link. Make sure sharing is set to 'Anyone with the link can edit'.",
};

function getGuidance(field: string): string {
  if (FIELD_GUIDANCE[field]) return FIELD_GUIDANCE[field];
  if (field.includes("checklist item")) return "Complete all items in the Pre-Submit Checklist before moving forward.";
  return "This field is required before the post can move forward.";
}

interface Props {
  errors: string[];
  onClose: () => void;
}

export function ValidationErrorModal({ errors, onClose }: Props) {
  if (errors.length === 0) return null;

  return (
    <>
      <div onClick={onClose} className="fixed inset-0 bg-black/40 dark:bg-black/60 z-[100] backdrop-blur-sm" />
      <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6" onClick={onClose}>
        <div
          className="w-full max-w-sm sm:max-w-md max-h-[75vh] sm:max-h-[80vh] flex flex-col rounded-2xl overflow-hidden
            bg-white/80 dark:bg-[#18181b]/85
            backdrop-blur-2xl
            border border-gray-200/60 dark:border-white/[0.12]
            shadow-[0_8px_32px_rgba(0,0,0,0.12)] dark:shadow-[0_8px_32px_rgba(0,0,0,0.5)]"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center gap-3 px-4 sm:px-5 py-3.5 sm:py-4 border-b border-gray-200/40 dark:border-white/[0.08] shrink-0">
            <div className="w-9 h-9 rounded-xl bg-red-500/10 dark:bg-red-500/15 flex items-center justify-center shrink-0">
              <AlertTriangle className="w-5 h-5 text-red-500" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-[14px] sm:text-[15px] font-bold text-gray-900 dark:text-white">Missing Required Fields</h3>
              <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">Complete these before continuing</p>
            </div>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100/80 dark:hover:bg-white/[0.06] text-gray-400 cursor-pointer transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Error list */}
          <div className="flex-1 overflow-y-auto px-4 sm:px-5 py-3 sm:py-4 space-y-2">
            {errors.map((field, i) => (
              <div key={i} className="flex gap-2.5 sm:gap-3 p-2.5 sm:p-3 rounded-xl bg-red-50/60 dark:bg-red-500/[0.06] border border-red-200/40 dark:border-red-500/[0.1]">
                <div className="w-5 h-5 rounded-full bg-red-500/15 dark:bg-red-500/20 flex items-center justify-center shrink-0 mt-0.5">
                  <span className="text-[10px] font-bold text-red-500">{i + 1}</span>
                </div>
                <div className="min-w-0">
                  <p className="text-[12px] sm:text-[13px] font-bold text-red-700 dark:text-red-400 capitalize">{field}</p>
                  <p className="text-[10px] sm:text-[11px] text-red-600/70 dark:text-red-300/60 mt-0.5 leading-relaxed">{getGuidance(field)}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Footer */}
          <div className="px-4 sm:px-5 py-3 sm:py-4 border-t border-gray-200/40 dark:border-white/[0.08] shrink-0">
            <button onClick={onClose}
              className="w-full h-10 rounded-xl bg-gray-900 dark:bg-white text-white dark:text-gray-900 text-[13px] font-semibold cursor-pointer hover:bg-gray-800 dark:hover:bg-gray-100 transition-colors shadow-sm">
              Got it
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
