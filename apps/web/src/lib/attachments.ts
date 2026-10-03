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

export {
  ATTACHMENT_MAX_BYTES,
  ATTACHMENT_EXTENSIONS,
  ATTACHMENT_ACCEPT,
  isImageAttachment,
  checkAttachment,
} from "./attachment-policy";
export type { AttachmentCheck, AttachmentRefusal } from "./attachment-policy";

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
  return sealSecret(JSON.stringify(payload), "attachment");
}

/**
 * Opens a token, or null for anything that is not one this install sealed and
 * still honours. Null rather than a throw: a stale token is an ordinary thing
 * for a client to hold, and losing an attachment must never lose the message.
 */
export function openAttachment(token: unknown): ChatAttachment | null {
  if (typeof token !== "string" || !token) return null;
  try {
    const payload = JSON.parse(openSecret(token, "attachment")) as SealedAttachment;
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
