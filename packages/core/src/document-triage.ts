/**
 * What an uploaded file actually is, before a parser is asked to read it
 * (#801, CYB-09).
 *
 * File acceptance trusted the suffix and the size. A suffix is a claim made by
 * whoever uploaded the file, so `.pdf` reached the PDF parser whatever the
 * bytes were, and an Office document reached Mammoth without anyone asking
 * whether it carried a macro project. Both of those are decisions, and both
 * were being made by a filename.
 *
 * Pure and byte-level on purpose: it reads the head, and for a ZIP container
 * the central directory at the tail, then answers yes or no. The caller can
 * refuse before allocating a parser, and this can be tested with archives
 * built in the test rather than with a corpus.
 */

export type DocumentTriage =
  | { ok: true }
  | { ok: false; code: DocumentTriageCode; reason: string };

/**
 * The rule-set version, part of the persisted verdict (#801, CYB-09): a
 * verdict without the rules that produced it cannot be re-evaluated. Bump on
 * any behavioral change to this module. v1 scanned a head window of local
 * file headers; v2 reads the central directory; v3 adds the decompression
 * budget over the directory's declared sizes.
 */
export const DOCUMENT_TRIAGE_VERSION = 3;

/**
 * What gets persisted about an accepted file (#801, CYB-09): which scanner,
 * which rule set, over which bytes (their sha256), and when. A refused file
 * never becomes a Source, so only `clean` is ever stored; the point of the
 * record is that "this file was checked" stops being a claim and becomes a
 * row an operator can audit, and a version bump names exactly which Sources
 * predate a rule.
 */
export interface TriageEvidence {
  scanner: "document-triage";
  version: number;
  sha256: string;
  verdict: "clean";
  at: string;
}

export type DocumentTriageCode =
  /** The bytes are not the format the extension claims. */
  | "signature_mismatch"
  /** The bytes are a program, whatever the extension says. */
  | "executable"
  /** An OOXML container carrying a macro project. */
  | "macro_enabled"
  /** An OOXML container carrying an embedded OLE object. */
  | "embedded_object"
  /** An archive declaring more decompressed bytes than any document needs. */
  | "decompression_bomb";

/** How much of the head is enough to identify a container. */
const HEAD_BYTES = 8;

/**
 * A ZIP's central directory is the authoritative list of what is inside it,
 * and it sits at the end. Reading it beats scanning for names in the local
 * file headers: entry order is chosen by whoever built the archive, so any
 * window into the front is a window something can be placed behind.
 *
 * The End of Central Directory record is the last 22 bytes plus a comment of
 * up to 64 KiB, so that is how far back the signature can be.
 */
const EOCD_SIGNATURE = 0x06054b50;
const EOCD_MIN_SIZE = 22;
const EOCD_MAX_COMMENT = 0xffff;
const CENTRAL_FILE_HEADER_SIGNATURE = 0x02014b50;

const startsWith = (bytes: Uint8Array, signature: readonly number[]): boolean =>
  signature.every((byte, index) => bytes[index] === byte);

/** ASCII helpers, written out so the signatures read as what they are. */
const PDF = [0x25, 0x50, 0x44, 0x46]; // %PDF
const ZIP = [0x50, 0x4b, 0x03, 0x04]; // PK\x03\x04
const ZIP_EMPTY = [0x50, 0x4b, 0x05, 0x06];
const PNG = [0x89, 0x50, 0x4e, 0x47];
const JPEG = [0xff, 0xd8, 0xff];
const GIF = [0x47, 0x49, 0x46, 0x38];
const RIFF = [0x52, 0x49, 0x46, 0x46]; // WebP is RIFF….WEBP

/** Program formats, refused whatever they claim to be. */
const EXECUTABLES: Array<{ signature: readonly number[]; label: string }> = [
  { signature: [0x4d, 0x5a], label: "a Windows executable" },
  { signature: [0x7f, 0x45, 0x4c, 0x46], label: "a Linux executable" },
  { signature: [0xcf, 0xfa, 0xed, 0xfe], label: "a macOS executable" },
  { signature: [0xca, 0xfe, 0xba, 0xbe], label: "a macOS executable" },
  { signature: [0x23, 0x21], label: "a script with a shebang" },
];

/** OOXML formats, which are ZIP containers. */
const OOXML_EXTENSIONS = new Set(["docx", "xlsx", "pptx"]);

/**
 * The decompression budget (#801, CYB-09): how many decompressed bytes an
 * accepted Office package may *declare* across its entries. Upload caps bound
 * the compressed size, which is exactly the number a zip bomb keeps small; a
 * 25 MiB archive may lawfully declare terabytes. The central directory states
 * each entry's uncompressed size, so the budget is enforced before a single
 * byte is inflated. 256 MiB is far past any real document (DEFLATE tops out
 * around 1000:1, and Mammoth holds the parts it reads in memory anyway) and
 * far below what an inflation attack needs.
 */
export const OOXML_DECOMPRESSED_BUDGET_BYTES = 256 * 1024 * 1024;

/** Names that make an OOXML package more than a document. */
const MACRO_PART = "vbaProject.bin";
const OLE_PART = "embeddings/oleObject";

export function documentExtension(name: string): string | null {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? null : name.slice(dot + 1).toLowerCase();
}

/**
 * The entry names an OOXML package declares, read from its central directory.
 * Empty when the archive is malformed or uses ZIP64, which the caller treats
 * as "cannot see inside" rather than "nothing inside": an Office file whose
 * directory cannot be read is not one this product needs to accept.
 */
export function zipEntryNames(bytes: Uint8Array): string[] | null {
  return zipDirectory(bytes)?.map((entry) => entry.name) ?? null;
}

/**
 * The central directory's entries: name and *declared* uncompressed size.
 * Null when the archive is malformed or uses ZIP64 (0xffffffff sizes/offsets),
 * which the caller treats as "cannot see inside" rather than "nothing inside".
 */
export function zipDirectory(
  bytes: Uint8Array
): Array<{ name: string; uncompressedSize: number }> | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const floor = Math.max(0, bytes.length - EOCD_MIN_SIZE - EOCD_MAX_COMMENT);
  let eocd = -1;
  for (let i = bytes.length - EOCD_MIN_SIZE; i >= floor; i--) {
    if (view.getUint32(i, true) === EOCD_SIGNATURE) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) return null;

  const count = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  // ZIP64 stores 0xffffffff here and puts the real offset elsewhere. Reading
  // that format is not worth it for a check whose answer is then "refuse".
  if (offset === 0xffffffff || count === 0xffff) return null;

  const entries: Array<{ name: string; uncompressedSize: number }> = [];
  for (let i = 0; i < count; i++) {
    if (offset + 46 > bytes.length) return null;
    if (view.getUint32(offset, true) !== CENTRAL_FILE_HEADER_SIGNATURE) return null;
    // Declared, not measured: the whole point is to answer before inflating.
    // 0xffffffff is the ZIP64 sentinel, same verdict as a ZIP64 offset.
    const uncompressedSize = view.getUint32(offset + 24, true);
    if (uncompressedSize === 0xffffffff) return null;
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const start = offset + 46;
    if (start + nameLength > bytes.length) return null;
    entries.push({
      name: new TextDecoder("utf-8").decode(bytes.subarray(start, start + nameLength)),
      uncompressedSize,
    });
    offset = start + nameLength + extraLength + commentLength;
  }
  return entries;
}

/**
 * Answers whether these bytes may be handed to a parser as the format the
 * filename claims. `ok` does not mean the document is safe to run, only that
 * it is the shape it says it is and carries no active content we can name.
 */
export function triageDocument(input: {
  name: string;
  bytes: Uint8Array;
}): DocumentTriage {
  const { bytes } = input;
  const extension = documentExtension(input.name);
  const head = bytes.subarray(0, HEAD_BYTES);

  for (const { signature, label } of EXECUTABLES) {
    if (startsWith(head, signature)) {
      return {
        ok: false,
        code: "executable",
        reason: `This file is ${label}, not a document.`,
      };
    }
  }

  if (extension === "pdf" && !startsWith(head, PDF)) {
    return {
      ok: false,
      code: "signature_mismatch",
      reason: "This file is named .pdf but its contents are not a PDF.",
    };
  }

  if (extension && OOXML_EXTENSIONS.has(extension)) {
    if (!startsWith(head, ZIP) && !startsWith(head, ZIP_EMPTY)) {
      return {
        ok: false,
        code: "signature_mismatch",
        reason: `This file is named .${extension} but its contents are not an Office document.`,
      };
    }
    const directory = zipDirectory(bytes);
    if (directory === null) {
      return {
        ok: false,
        code: "signature_mismatch",
        reason: `This .${extension} file's contents could not be read as an Office document.`,
      };
    }
    const names = directory.map((entry) => entry.name);
    // Budgeted before a byte is inflated (#801, CYB-09): the upload cap
    // bounds the compressed size, which is the number a bomb keeps small.
    const declared = directory.reduce((sum, entry) => sum + entry.uncompressedSize, 0);
    if (declared > OOXML_DECOMPRESSED_BUDGET_BYTES) {
      return {
        ok: false,
        code: "decompression_bomb",
        reason: `This Office file declares ${Math.round(declared / (1024 * 1024))} MiB of content when unpacked, which no document needs. It will not be processed.`,
      };
    }
    if (names.some((name) => name.endsWith(MACRO_PART))) {
      return {
        ok: false,
        code: "macro_enabled",
        reason:
          "This Office file contains a macro project. Save it without macros and upload it again.",
      };
    }
    if (names.some((name) => name.includes(OLE_PART))) {
      return {
        ok: false,
        code: "embedded_object",
        reason:
          "This Office file contains an embedded object. Remove it and upload the document again.",
      };
    }
  }

  if (extension === "png" && !startsWith(head, PNG)) return mismatch("PNG");
  if ((extension === "jpg" || extension === "jpeg") && !startsWith(head, JPEG)) {
    return mismatch("JPEG");
  }
  if (extension === "gif" && !startsWith(head, GIF)) return mismatch("GIF");
  if (extension === "webp" && !startsWith(head, RIFF)) return mismatch("WebP");

  // Everything else (txt, md, csv, json…) has no signature to check. The
  // executable test above is what stops one of them from being a program.
  return { ok: true };
}

function mismatch(format: string): DocumentTriage {
  return {
    ok: false,
    code: "signature_mismatch",
    reason: `This file is named as a ${format} image but its contents are not one.`,
  };
}
