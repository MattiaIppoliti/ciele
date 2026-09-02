import { describe, expect, it } from "vitest";
import {
  OOXML_DECOMPRESSED_BUDGET_BYTES, documentExtension, triageDocument } from "./document-triage";

/**
 * #801, CYB-09. The suffix is a claim made by whoever uploaded the file, so
 * every case here is about the bytes disagreeing with it, plus the two things
 * an OOXML package can carry that a document has no need for.
 */

const bytes = (...values: number[]) => new Uint8Array(values);
const ascii = (text: string) =>
  new Uint8Array([...text].map((char) => char.charCodeAt(0)));

const concat = (...parts: Uint8Array[]) => {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
};

const PDF_HEAD = ascii("%PDF-1.7\n");
const ZIP_HEAD = bytes(0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00);

/**
 * A stored-method ZIP with the given entry names and no content. Built here
 * rather than fixtured, because the property under test is that the *central
 * directory* is what gets read: an archive whose entry order was chosen to
 * hide something has to be constructible to be refutable.
 */
function zip(
  names: string[],
  options: { comment?: string; declaredSizes?: Record<string, number> } = {}
): Uint8Array {
  const encoder = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;

  for (const name of names) {
    const nameBytes = encoder.encode(name);
    const local = new Uint8Array(30 + nameBytes.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    locals.push(local);

    const central = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    // The *declared* uncompressed size: what a bomb lies big in.
    centralView.setUint32(24, options.declaredSizes?.[name] ?? 0, true);
    centralView.setUint16(28, nameBytes.length, true);
    centralView.setUint32(42, offset, true);
    central.set(nameBytes, 46);
    centrals.push(central);

    offset += local.length;
  }

  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
  const comment = encoder.encode(options.comment ?? "");
  const eocd = new Uint8Array(22 + comment.length);
  const eocdView = new DataView(eocd.buffer);
  eocdView.setUint32(0, 0x06054b50, true);
  eocdView.setUint16(8, names.length, true);
  eocdView.setUint16(10, names.length, true);
  eocdView.setUint32(12, centralSize, true);
  eocdView.setUint32(16, offset, true);
  eocdView.setUint16(20, comment.length, true);
  eocd.set(comment, 22);

  return concat(...locals, ...centrals, eocd);
}

const DOCX = ["[Content_Types].xml", "word/document.xml"];

describe("triageDocument", () => {
  it("accepts a document whose bytes match its name", () => {
    expect(triageDocument({ name: "handbook.pdf", bytes: PDF_HEAD })).toEqual({
      ok: true,
    });
    expect(triageDocument({ name: "notes.docx", bytes: zip(DOCX) })).toEqual({
      ok: true,
    });
    expect(triageDocument({ name: "readme.md", bytes: ascii("# Title") })).toEqual({
      ok: true,
    });
  });

  it("refuses a program however it is named", () => {
    for (const [name, head] of [
      ["invoice.pdf", bytes(0x4d, 0x5a, 0x90, 0x00)],
      ["notes.docx", bytes(0x7f, 0x45, 0x4c, 0x46)],
      ["readme.md", ascii("#!/bin/sh\nrm -rf /")],
    ] as const) {
      const verdict = triageDocument({ name, bytes: head });
      expect(verdict, name).toMatchObject({ ok: false, code: "executable" });
    }
  });

  it("refuses bytes that are not the format the extension claims", () => {
    expect(
      triageDocument({ name: "invoice.pdf", bytes: ascii("<html><body>hi") }),
    ).toMatchObject({ ok: false, code: "signature_mismatch" });
    expect(
      triageDocument({ name: "report.docx", bytes: PDF_HEAD }),
    ).toMatchObject({ ok: false, code: "signature_mismatch" });
    expect(
      triageDocument({ name: "logo.png", bytes: ascii("GIF89a") }),
    ).toMatchObject({ ok: false, code: "signature_mismatch" });
  });

  it("refuses an Office package carrying a macro project", () => {
    // A .docx that is really a macro-enabled document renamed: the extension
    // is the only thing that changed, and the extension is what was trusted.
    expect(
      triageDocument({
        name: "payroll.docx",
        bytes: zip([...DOCX, "word/vbaProject.bin"]),
      }),
    ).toMatchObject({ ok: false, code: "macro_enabled" });
  });

  it("refuses an Office package carrying an embedded OLE object", () => {
    expect(
      triageDocument({
        name: "brief.docx",
        bytes: zip([...DOCX, "word/embeddings/oleObject1.bin"]),
      }),
    ).toMatchObject({ ok: false, code: "embedded_object" });
  });

  it("finds a macro however far into the archive it was placed", () => {
    // Entry order is chosen by whoever built the archive, so a check that
    // scans a window into the front is a check something can be placed
    // behind. The central directory is the authoritative list.
    const padding = Array.from({ length: 400 }, (_, i) => `word/media/image${i}.png`);
    expect(
      triageDocument({
        name: "big.docx",
        bytes: zip([...DOCX, ...padding, "word/vbaProject.bin"]),
      }),
    ).toMatchObject({ ok: false, code: "macro_enabled" });
  });

  it("refuses an archive declaring more than the decompression budget (#801, CYB-09)", () => {
    // A 25 MiB upload may lawfully declare terabytes: the upload cap bounds
    // the compressed size, which is exactly the number a bomb keeps small.
    // The verdict must land before a single byte is inflated, so it reads the
    // directory's declared sizes, not the inflated content.
    const bomb = zip(DOCX, {
      declaredSizes: {
        "word/document.xml": OOXML_DECOMPRESSED_BUDGET_BYTES,
        "[Content_Types].xml": 1,
      },
    });
    expect(triageDocument({ name: "report.docx", bytes: bomb })).toMatchObject({
      ok: false,
      code: "decompression_bomb",
    });

    // At the budget is still a document; the refusal is strictly past it.
    const large = zip(DOCX, {
      declaredSizes: { "word/document.xml": OOXML_DECOMPRESSED_BUDGET_BYTES - 1 },
    });
    expect(triageDocument({ name: "report.docx", bytes: large })).toEqual({ ok: true });
  });

  it("treats a ZIP64 size sentinel as unreadable, not as small (#801, CYB-09)", () => {
    // 0xffffffff means "the real size is elsewhere"; reading elsewhere is not
    // worth it for a check whose answer would then be refuse anyway.
    const zip64 = zip(DOCX, {
      declaredSizes: { "word/document.xml": 0xffffffff },
    });
    expect(triageDocument({ name: "report.docx", bytes: zip64 })).toMatchObject({
      ok: false,
      code: "signature_mismatch",
    });
  });

  it("finds the directory behind a maximal archive comment", () => {
    expect(
      triageDocument({
        name: "commented.docx",
        bytes: zip([...DOCX, "word/vbaProject.bin"], { comment: "x".repeat(65_535) }),
      }),
    ).toMatchObject({ ok: false, code: "macro_enabled" });
  });

  it("refuses a package whose directory cannot be read at all", () => {
    // Fail closed: an Office file we cannot see inside is not one this
    // product needs to accept.
    expect(
      triageDocument({ name: "truncated.docx", bytes: concat(ZIP_HEAD, ascii("word/")) }),
    ).toMatchObject({ ok: false, code: "signature_mismatch" });
  });
});

describe("documentExtension", () => {
  it("takes the last suffix, lowercased, and nothing when there is none", () => {
    expect(documentExtension("Report.FINAL.PDF")).toBe("pdf");
    expect(documentExtension("archive.tar.gz")).toBe("gz");
    expect(documentExtension("Makefile")).toBeNull();
  });
});
