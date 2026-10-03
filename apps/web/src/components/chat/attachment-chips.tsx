"use client";

import { FileText, Upload, X } from "lucide-react";
import { Image as ImageIcon, Loader2 } from "lucide-react";
import { isImageAttachment } from "@/lib/attachment-policy";
import type { AttachmentEntry } from "@/components/chat/use-attachments";
import { formatCount } from "@/lib/format";
import { RollInText } from "@/components/motion/roll-in-text";

/**
 * The strip above the composer: what is attached, and therefore what is still
 * being sent with every message in this conversation.
 *
 * Visible for as long as it is in scope, on purpose. The alternative, clearing
 * after send and keeping it server-side, would leave people paying for a file
 * in every prompt with nothing on screen saying so.
 */
export function AttachmentChips({
  entries,
  onRemove,
}: {
  entries: readonly AttachmentEntry[];
  onRemove: (id: string) => void;
}) {
  if (entries.length === 0) return null;
  return (
    <ul className="mb-2 flex flex-wrap gap-1.5">
      {entries.map((entry) => {
        const failed = entry.state === "failed";
        return (
          <li
            key={entry.id}
            // The same grey as the composer's tag: marked enough to read as
            // something attached, on the light theme and the dark one.
            className={`flex max-w-full items-center gap-1.5 rounded-lg border px-2 py-1 text-xs ${
              failed
                ? "border-destructive/40 text-destructive"
                : "bg-foreground/[0.12] text-foreground/80 border-transparent"
            }`}
          >
            <span aria-hidden="true" className="shrink-0 [&_svg]:size-3.5">
              {entry.state === "reading" ? (
                <Loader2 className="animate-spin motion-reduce:animate-none" />
              ) : isImageAttachment(entry.name) ? (
                <ImageIcon />
              ) : (
                <FileText />
              )}
            </span>
            <span className="min-w-0 truncate font-medium"><RollInText text={entry.name} /></span>
            {/* Polite: a file finishing its read, or failing, is news the
                composer's user would otherwise only see. */}
            <span aria-live="polite" className="shrink-0 whitespace-nowrap">
              {entry.state === "failed" ? (
                entry.message
              ) : (
                <RollInText
                  text={
                    entry.state === "reading"
                      ? "reading…"
                      : `${formatCount(entry.chars)} characters`
                  }
                  duration={380}
                />
              )}
            </span>
            <button
              type="button"
              aria-label={`Remove ${entry.name}`}
              onClick={() => onRemove(entry.id)}
              className="hover:text-foreground shrink-0 cursor-pointer [&_svg]:size-3.5"
            >
              <X />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * A hidden file input the `+` menu opens.
 *
 * `capture` is deliberately absent: on a phone that would send someone straight
 * to the camera, and the common case is a screenshot or a document they already
 * have.
 */
export function AttachmentInput({
  inputRef,
  accept,
  onPick,
}: {
  inputRef: React.RefObject<HTMLInputElement | null>;
  accept: string;
  onPick: (file: File) => void;
}) {
  return (
    <input
      ref={inputRef}
      type="file"
      accept={accept}
      className="hidden"
      onChange={(event) => {
        const file = event.target.files?.[0];
        // Cleared so picking the same file twice still fires a change.
        event.target.value = "";
        if (file) onPick(file);
      }}
    />
  );
}

/**
 * The "drop it here" state, drawn over the composer while a file is above it.
 *
 * `pointer-events-none` matters: an overlay that took the pointer would sit
 * between the cursor and the element listening for the drop, and the file would
 * land on nothing.
 */
export function AttachmentDropHint({ label }: { label: string }) {
  return (
    <div className="bg-background/85 border-primary text-primary pointer-events-none absolute inset-0 z-30 flex items-center justify-center gap-2 rounded-2xl border-2 border-dashed text-sm font-medium">
      <Upload className="size-4" />
      {label}
    </div>
  );
}
