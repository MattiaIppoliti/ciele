import {
  ATTACHMENT_MAX_CHARS,
  MAX_ATTACHMENTS_PER_MESSAGE,
  capMemoryDocument,
  openSecret,
  sealSecret,
  type ChatAttachment,
} from "@agent-hub/core";
import { createRateLimiter, type RateLimitDecision } from "@/lib/rate-limit";

/**
 * Files attached to one chat message.
 *
 * **Nothing is stored.** The bytes are read once, turned into text, and
 * dropped: no bucket, no Source row, no object anybody has to retain, expire or
 * later explain to a regulator. That is a deliberate line, not an omission. The
 * existing upload path (`uploadFileSourceAction` → `addSourceOp` → ingestion)
 * would have been the easy thing to reuse and is the wrong one: it makes a
 * permanent, org-searchable Knowledge Source, so a Visitor's screenshot would
 * be cited in every later conversation by an Assistant nobody asked to learn
 * it. An attachment belongs to its conversation.
 *
 * What travels instead is a **sealed** token. The extracted text is
 * AES-256-GCM-sealed with the install's own key (`sealSecret`) and handed to the
 * client opaque; the client sends it back with the message and the chat route
 * opens it. GCM is authenticated, so the round trip cannot be edited. That
 * matters more than it sounds: the text lands in the system prompt, above the
 * transcript, so a client that could write it directly could write the
 * Assistant's instructions.
 */

/** What the composer shows for a file it has uploaded but not yet sent. */
export interface AttachmentReceipt {
  name: string;
  /** Characters of text read out of it, for "2,300 characters read". */
  chars: number;
  /** Opaque; the only thing that goes back with the message. */
  token: string;
}

/**
 * Bytes one file may be. Well under the 25 MiB Knowledge cap: a chat
 * attachment is read for the next few sentences of a conversation, and a
 * 25 MiB PDF is a document somebody should be adding to the Library instead.
 */
export const ATTACHMENT_MAX_BYTES = 8 * 1024 * 1024;

/**
 * What the composer offers. Every one of these has a real reader behind it
 * (`extractSourceText`), which is why the list is written here rather than
 * derived from something broader: an extension nothing can read is a file
 * picker that accepts work it will refuse.
 */
export const ATTACHMENT_EXTENSIONS = [
  "pdf",
  "docx",
  "xlsx",
  "pptx",
  "txt",
  "md",
  "markdown",
  "csv",
  "tsv",
  "json",
  "log",
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
] as const;

/** The `accept` attribute for a file input, from the one list above. */
export const ATTACHMENT_ACCEPT = ATTACHMENT_EXTENSIONS.map((e) => `.${e}`).join(",");

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp"]);

/**
 * The pre-2007 Office formats. They are refused by name rather than by the
 * generic "cannot read that" sentence, because the person holding a `.doc`
 * usually has a Save As away from a file that works, and no list of accepted
 * types tells them that.
 *
 * Not supported because they share nothing with their successors: these are
 * OLE compound binaries, not OOXML, so each would be a parser of its own for a
 * format Office stopped defaulting to nearly twenty years ago.
 */
const LEGACY_OFFICE: Record<string, string | undefined> = {
  doc: "docx",
  xls: "xlsx",
  ppt: "pptx",
};

/** Whether this name is one an image reader has to be available for. */
export function isImageAttachment(name: string): boolean {
  return IMAGE_EXTENSIONS.has(extensionOf(name));
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot + 1).toLowerCase();
}

/** Refusal reasons the caller turns into a status code and a sentence. */
export type AttachmentRefusal =
  | { ok: false; reason: string };

export type AttachmentCheck = { ok: true } | AttachmentRefusal;

/** Shape only: what the bytes really are is `triageDocument`'s answer, later. */
export function checkAttachment(file: {
  name: string;
  size: number;
}): AttachmentCheck {
  const extension = extensionOf(file.name);
  const modern = LEGACY_OFFICE[extension];
  if (modern) {
    return {
      ok: false,
      reason: `Old Office files are not supported. Save it as .${modern} and attach that.`,
    };
  }
  if (!(ATTACHMENT_EXTENSIONS as readonly string[]).includes(extension)) {
    return {
      ok: false,
      reason:
        "That file type cannot be read. Attach a PDF, Word, Excel, PowerPoint, Markdown, text or image file.",
    };
  }
  if (file.size <= 0) return { ok: false, reason: "That file is empty." };
  if (file.size > ATTACHMENT_MAX_BYTES) {
    const mb = Math.round(ATTACHMENT_MAX_BYTES / (1024 * 1024));
    return { ok: false, reason: `That file is over ${mb}MB.` };
  }
  return { ok: true };
}

/**
 * How long a sealed token is good for.
 *
 * Not a secrecy measure: the token carries text its holder uploaded, and
 * sealing is there to stop *editing*, not reading. The window bounds replay, and
 * it is generous because someone may attach a file, get distracted, and send
 * the message half an hour later.
 */
const TOKEN_TTL_MS = 60 * 60 * 1000;

interface SealedAttachment {
  name: string;
  text: string;
  /** Epoch ms. */
  exp: number;
}

export function sealAttachment(attachment: ChatAttachment): string {
  const payload: SealedAttachment = {
    name: attachment.name,
    text: capMemoryDocument(attachment.text, ATTACHMENT_MAX_CHARS),
    exp: Date.now() + TOKEN_TTL_MS,
  };
  return sealSecret(JSON.stringify(payload));
}

/**
 * Opens a token, or null for anything that is not one this install sealed and
 * still honours. Null rather than a throw: a stale token is an ordinary thing
 * for a client to hold, and losing an attachment must never lose the message.
 */
export function openAttachment(token: unknown): ChatAttachment | null {
  if (typeof token !== "string" || !token) return null;
  try {
    const payload = JSON.parse(openSecret(token)) as SealedAttachment;
    if (typeof payload?.text !== "string" || typeof payload?.name !== "string") {
      return null;
    }
    if (typeof payload.exp !== "number" || payload.exp < Date.now()) return null;
    return { name: payload.name, text: payload.text };
  } catch {
    return null;
  }
}

/** Every token a message carried, opened, in order, capped, bad ones dropped. */
export function openAttachments(tokens: unknown): ChatAttachment[] {
  if (!Array.isArray(tokens)) return [];
  return tokens
    .slice(0, MAX_ATTACHMENTS_PER_MESSAGE)
    .map(openAttachment)
    .filter((attachment): attachment is ChatAttachment => attachment !== null);
}

/**
 * Per-uploader budget. Reading a file is parser work and, for an image, a model
 * call, so the loop worth bounding is the one that uploads rather than the one
 * that chats. Keyed by the caller on whoever is identifiable: a Member for the
 * console, a visitor id for the widget.
 *
 * Same in-process, per-instance caveat `rate-limit.ts` documents: on serverless
 * this bounds a warm instance, not the fleet. It still turns a trivial loop
 * into work.
 */
const attachmentLimiter = createRateLimiter({ limit: 15, windowMs: 10 * 60 * 1000 });

export function checkAttachmentAllowance(
  key: string,
  now?: number
): RateLimitDecision {
  return attachmentLimiter.check(key, now);
}

/** Test seam: forget every window. */
export function resetAttachmentAllowance(): void {
  attachmentLimiter.reset();
}
