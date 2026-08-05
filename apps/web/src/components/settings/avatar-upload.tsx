"use client";

import { useRef } from "react";
import { Pencil } from "lucide-react";
import { toast } from "@/lib/toast";

const AVATAR_MAX_BYTES = 2 * 1024 * 1024;

/**
 * Click-to-upload circular image picker: validates the file and hands it to
 * the caller, which uploads it to object storage and owns the resulting URL.
 * Shared by the assistant editor, Settings > Profile, and Settings >
 * Organization so the upload UX never drifts between them.
 */
export function AvatarUpload({
  value,
  onFile,
  onRemove,
  fallback,
  size = "size-24",
  label = "Choose photo",
}: {
  value: string;
  /** Storage-backed upload: the caller receives the File and owns upload. */
  onFile: (file: File) => void;
  /** When given, a "Remove" button appears next to the avatar once `value`
   * is set (e.g. an org logo, which — unlike an assistant's — can be
   * cleared back to the initial-letter fallback). */
  onRemove?: () => void;
  /** Rendered in place of the image when `value` is empty. */
  fallback: React.ReactNode;
  size?: string;
  label?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (
      !["image/gif", "image/jpeg", "image/png", "image/webp"].includes(
        file.type
      )
    ) {
      toast.error("Choose a PNG, JPEG, GIF, or WebP image");
      return;
    }
    if (file.size > AVATAR_MAX_BYTES) {
      toast.error("Image is too large, the maximum supported size is 2 MB");
      return;
    }
    onFile(file);
  }

  return (
    <div className="flex items-center gap-3">
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="hidden"
        onChange={handleChange}
      />
      <button
        type="button"
        aria-label={label}
        onClick={() => inputRef.current?.click()}
        className={`group relative ${size} shrink-0 overflow-hidden rounded-full`}
      >
        {value ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={value} alt="" className="size-full object-cover" />
        ) : (
          fallback
        )}
        <span className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/0 text-transparent transition-colors group-hover:bg-black/60 group-hover:text-white">
          <Pencil className="size-4" />
          <span className="text-xs font-medium">{label}</span>
        </span>
      </button>
      {onRemove && value && (
        <button
          type="button"
          onClick={onRemove}
          className="text-muted-foreground text-sm font-medium underline underline-offset-4 hover:text-foreground"
        >
          Remove
        </button>
      )}
    </div>
  );
}
