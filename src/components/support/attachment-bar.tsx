"use client";

// Shared attachment picker for the ticket form and the chat composer.
// Validates type/size/count on the client (the API and the storage bucket
// validate again); previews images and marks videos.

import { useMemo, useRef, useEffect } from "react";
import { Paperclip, X, Film } from "lucide-react";
import {
  SUPPORT_ALLOWED_MIME,
  SUPPORT_MAX_FILE_BYTES,
  SUPPORT_MAX_FILES,
  isAllowedSupportMime,
} from "@/lib/support/format";

interface AttachmentBarProps {
  files: File[];
  onChange: (files: File[]) => void;
  onError?: (message: string) => void;
  disabled?: boolean;
}

export function AttachmentBar({ files, onChange, onError, disabled }: AttachmentBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const previews = useMemo(
    () =>
      files.map((f) => ({
        file: f,
        name: f.name,
        isVideo: f.type.startsWith("video/"),
        url: f.type.startsWith("image/") ? URL.createObjectURL(f) : null,
      })),
    [files],
  );

  // Revoke object URLs when the file set changes or the component unmounts.
  useEffect(() => {
    return () => {
      previews.forEach((p) => {
        if (p.url) URL.revokeObjectURL(p.url);
      });
    };
  }, [previews]);

  function handlePick(picked: FileList | null) {
    if (!picked || picked.length === 0) return;
    const accepted: File[] = [];
    for (const f of Array.from(picked)) {
      if (!isAllowedSupportMime(f.type)) {
        onError?.(`"${f.name}" is not a supported file type.`);
        continue;
      }
      if (f.size === 0) {
        onError?.(`"${f.name}" is empty.`);
        continue;
      }
      if (f.size > SUPPORT_MAX_FILE_BYTES) {
        onError?.(`"${f.name}" is larger than 25 MB.`);
        continue;
      }
      accepted.push(f);
    }
    const combined = [...files, ...accepted];
    if (combined.length > SUPPORT_MAX_FILES) {
      onError?.(`You can attach up to ${SUPPORT_MAX_FILES} files.`);
      onChange(combined.slice(0, SUPPORT_MAX_FILES));
    } else {
      onChange(combined);
    }
    if (inputRef.current) inputRef.current.value = "";
  }

  function removeAt(index: number) {
    onChange(files.filter((_, i) => i !== index));
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {previews.map((p, i) => (
        <div
          key={`${p.name}-${i}`}
          className="group relative h-14 w-14 shrink-0 overflow-hidden rounded-lg border border-gray-200 bg-gray-50 dark:border-white/10 dark:bg-white/[0.04]"
        >
          {p.url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={p.url} alt={p.name} className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full flex-col items-center justify-center text-gray-400">
              <Film className="h-4 w-4" />
              <span className="mt-0.5 text-[8px] font-medium">{p.isVideo ? "Video" : "File"}</span>
            </div>
          )}
          {!disabled && (
            <button
              type="button"
              onClick={() => removeAt(i)}
              aria-label={`Remove ${p.name}`}
              className="absolute right-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      ))}

      {files.length < SUPPORT_MAX_FILES && (
        <button
          type="button"
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
          className="inline-flex h-11 items-center gap-1.5 rounded-lg border border-dashed border-gray-300 px-3 text-[12px] font-medium text-gray-500 transition-colors hover:border-orange-400 hover:text-orange-500 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/15 dark:text-gray-400"
        >
          <Paperclip className="h-3.5 w-3.5" />
          Attach
        </button>
      )}

      <input
        ref={inputRef}
        type="file"
        multiple
        accept={SUPPORT_ALLOWED_MIME.join(",")}
        className="hidden"
        onChange={(e) => handlePick(e.target.files)}
      />
    </div>
  );
}
