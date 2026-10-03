/** Client-safe file policy shared by upload admission and the composer. */
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
