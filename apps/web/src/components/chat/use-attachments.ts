"use client";

import { useEffect, useRef, useState } from "react";
import type { ClipboardEvent, DragEvent } from "react";
import { MAX_ATTACHMENTS_PER_MESSAGE } from "@agent-hub/core";
import {
  ATTACHMENT_ACCEPT,
  checkAttachment,
  type AttachmentReceipt,
} from "@/lib/attachments";

/** One row in the composer's attachment strip. */
export type AttachmentEntry =
  | { state: "reading"; id: string; name: string }
  | { state: "ready"; id: string; name: string; chars: number; token: string }
  | { state: "failed"; id: string; name: string; message: string };

/**
 * The composer's attachments: picked, read, and kept for the conversation.
 *
 * Reading happens when the file is picked, not when the message is sent, so the
 * wait is paid while somebody is still typing rather than after they press
 * send, and an unreadable file says so before it has cost them a message.
 *
 * They are **not** cleared after sending. An attachment stays in scope for the
 * follow-up questions, which is what people expect of a file they just showed
 * you, and the strip stays visible so what is still in the prompt is what is
 * still on screen. Removing a chip is how you take it back.
 *
 * Three ways in, because people reach for all three: the `+` menu, dropping a
 * file on the composer, and pasting one. Paste matters more than it looks, and
 * it is how a screenshot arrives: take one, press paste, done, with no file on
 * disk at any point.
 *
 * `upload` is the caller's, because the two surfaces differ: the widget posts
 * to its own route, the console calls a Server Action.
 */
export function useAttachments(
  upload: (file: File) => Promise<
    { ok: true; name: string; chars: number; token: string } | { ok: false; message: string }
  >
) {
  const [entries, setEntries] = useState<AttachmentEntry[]>([]);
  const [dragging, setDragging] = useState(false);
  const nextId = useRef(0);
  /** `dragenter`/`dragleave` fire per child; this counts the pair off. */
  const depth = useRef(0);

  const ready = entries.filter(
    (entry): entry is Extract<AttachmentEntry, { state: "ready" }> =>
      entry.state === "ready"
  );
  const full = entries.length >= MAX_ATTACHMENTS_PER_MESSAGE;

  /**
   * Swallows a file dropped anywhere else.
   *
   * Without it the browser navigates to the file, which in the widget means the
   * host page's iframe is replaced by somebody's PDF: a missed drop would
   * destroy the conversation rather than do nothing. Only dragged *files* are
   * swallowed, so dragging a link or selected text still behaves normally.
   */
  useEffect(() => {
    const swallow = (event: globalThis.DragEvent) => {
      if (event.dataTransfer?.types?.includes("Files")) event.preventDefault();
    };
    window.addEventListener("dragover", swallow);
    window.addEventListener("drop", swallow);
    return () => {
      window.removeEventListener("dragover", swallow);
      window.removeEventListener("drop", swallow);
    };
  }, []);

  async function attach(file: File) {
    if (full) return;
    const check = checkAttachment({ name: file.name, size: file.size });
    const id = `a${nextId.current++}`;
    if (!check.ok) {
      setEntries((prev) => [
        ...prev,
        { state: "failed", id, name: file.name, message: check.reason },
      ]);
      return;
    }
    setEntries((prev) => [...prev, { state: "reading", id, name: file.name }]);
    const result = await upload(file).catch(() => ({
      ok: false as const,
      message: "That file could not be read.",
    }));
    setEntries((prev) =>
      prev.map((entry) =>
        entry.id === id
          ? result.ok
            ? {
                state: "ready" as const,
                id,
                name: result.name,
                chars: result.chars,
                token: result.token,
              }
            : {
                state: "failed" as const,
                id,
                name: file.name,
                message: result.message,
              }
          : entry
      )
    );
  }

  /** Several at once, up to the cap; a drop or a paste can carry more than one. */
  async function attachAll(files: ArrayLike<File> | null | undefined) {
    if (!files) return;
    const room = MAX_ATTACHMENTS_PER_MESSAGE - entries.length;
    // Sequential rather than parallel: each one is parser work and an image is
    // a model call, and three at once on a phone is how a drop becomes a stall.
    for (const file of Array.from(files).slice(0, Math.max(0, room))) {
      await attach(file);
    }
  }

  return {
    entries,
    /** True while a file is over the composer, for the drop hint. */
    dragging,
    /**
     * Spread on whatever counts as the drop target. `dragenter`/`dragleave`
     * fire for every child element the pointer crosses, so the depth counter is
     * what keeps the hint from flickering as it moves over the chips and the
     * input.
     */
    dropProps: {
      onDragEnter: (event: DragEvent) => {
        if (!event.dataTransfer?.types?.includes("Files")) return;
        event.preventDefault();
        depth.current += 1;
        setDragging(true);
      },
      onDragOver: (event: DragEvent) => {
        if (!event.dataTransfer?.types?.includes("Files")) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      },
      onDragLeave: () => {
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setDragging(false);
      },
      onDrop: (event: DragEvent) => {
        if (!event.dataTransfer?.types?.includes("Files")) return;
        event.preventDefault();
        depth.current = 0;
        setDragging(false);
        void attachAll(event.dataTransfer.files);
      },
    },
    /**
     * Put on the composer's textarea. A pasted screenshot arrives as a file
     * with no name of its own, so it gets one: "image.png" reads better in the
     * strip and in the prompt than the empty string the clipboard supplies.
     */
    onPaste: (event: ClipboardEvent) => {
      const files = Array.from(event.clipboardData?.files ?? []);
      if (files.length === 0) return;
      // Only when the clipboard holds no text: copying a cell out of a
      // spreadsheet puts both on it, and the words are what was meant.
      if (event.clipboardData?.getData("text/plain")?.trim()) return;
      event.preventDefault();
      void attachAll(
        files.map((file) =>
          file.name
            ? file
            : new File([file], `image.${file.type.split("/")[1] || "png"}`, {
                type: file.type,
              })
        )
      );
    },
    attachAll,
    /** What goes with the message; only the ones that actually read. */
    tokens: ready.map((entry) => entry.token),
    /** A read is in flight: sending now would drop it silently. */
    busy: entries.some((entry) => entry.state === "reading"),
    full,
    attach,
    remove: (id: string) =>
      setEntries((prev) => prev.filter((entry) => entry.id !== id)),
    clear: () => setEntries([]),
    accept: ATTACHMENT_ACCEPT,
  };
}

export type { AttachmentReceipt };
