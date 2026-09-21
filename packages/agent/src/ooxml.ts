import { zipDirectory, type ZipEntry } from "@agent-hub/core";
import { inflateRawSync } from "node:zlib";

/**
 * Text out of a spreadsheet or a deck.
 *
 * Both are OOXML: a ZIP of XML parts. `@agent-hub/core` already reads a ZIP's
 * central directory, because triage has to know what an archive contains before
 * anything inflates it, and `cheerio` is already here for HTML. So the whole
 * reader is those two plus `node:zlib`, rather than a spreadsheet library in the
 * one code path whose input is a file a stranger uploaded.
 *
 * Word is deliberately not here: `mammoth` reads it, handles styles and lists,
 * and was already a dependency.
 *
 * What comes out is meant for a model to read, not to round-trip: a sheet
 * becomes tab-separated rows under its own name, a deck becomes one block per
 * slide. Formulas, formatting and images are dropped, because none of them
 * survive being flattened into a prompt anyway.
 */

/** Inflated bytes one file may cost, whatever its parts declare. */
const MAX_INFLATED_BYTES = 8 * 1024 * 1024;

/** Stored and deflate. An OOXML part is never anything else in practice. */
const METHOD_STORED = 0;
const METHOD_DEFLATE = 8;

const LOCAL_HEADER_SIGNATURE = 0x04034b50;

/** A budget carried across every part of one archive, not per part. */
interface InflationBudget {
  remaining: number;
}

/**
 * One entry's bytes, or null when the archive lies about where they are.
 *
 * The central directory says where the local header sits; the local header says
 * how long its own name and extra fields are, and the data begins after them.
 * The two disagree in a malformed archive, which is why the signature is
 * checked rather than assumed.
 */
function readEntry(
  bytes: Uint8Array,
  entry: ZipEntry,
  budget: InflationBudget
): Uint8Array | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const header = entry.localHeaderOffset;
  if (header + 30 > bytes.length) return null;
  if (view.getUint32(header, true) !== LOCAL_HEADER_SIGNATURE) return null;
  const nameLength = view.getUint16(header + 26, true);
  const extraLength = view.getUint16(header + 28, true);
  const start = header + 30 + nameLength + extraLength;
  const end = start + entry.compressedSize;
  if (end > bytes.length) return null;

  // Declared, so it is checked before the work and again after: a part may
  // claim to be small and inflate to anything.
  if (entry.uncompressedSize > budget.remaining) return null;

  const raw = bytes.subarray(start, end);
  let out: Uint8Array;
  if (entry.compressionMethod === METHOD_STORED) {
    out = raw;
  } else if (entry.compressionMethod === METHOD_DEFLATE) {
    try {
      out = new Uint8Array(inflateRawSync(raw, { maxOutputLength: budget.remaining }));
    } catch {
      return null;
    }
  } else {
    return null;
  }
  budget.remaining -= out.length;
  return budget.remaining < 0 ? null : out;
}

/** Loads the XML parts this reader wants, by exact name or by prefix. */
function partLoader(bytes: Uint8Array) {
  const entries = zipDirectory(bytes);
  if (!entries) return null;
  const budget: InflationBudget = { remaining: MAX_INFLATED_BYTES };
  const decoder = new TextDecoder("utf-8");
  const byName = new Map(entries.map((entry) => [entry.name, entry]));
  return {
    entries,
    read(name: string): string | null {
      const entry = byName.get(name);
      if (!entry) return null;
      const out = readEntry(bytes, entry, budget);
      return out ? decoder.decode(out) : null;
    },
  };
}

type Cheerio = Awaited<typeof import("cheerio")>;

/** `cheerio` in XML mode: OOXML parts are namespaced XML, not HTML. */
async function loadXml(load: Cheerio["load"], xml: string) {
  return load(xml, { xml: { xmlMode: true } });
}

/**
 * A spreadsheet as text: one block per sheet, tab-separated rows.
 *
 * Cell values live in two places. A string cell usually carries an index into
 * the workbook's shared-string table (`t="s"`), because a spreadsheet repeats
 * itself; an inline one carries its own text. Resolving both is what makes the
 * difference between rows of words and rows of integers.
 */
async function xlsxText(bytes: Uint8Array): Promise<string> {
  const parts = partLoader(bytes);
  if (!parts) return "";
  const { load } = await import("cheerio");

  const sharedXml = parts.read("xl/sharedStrings.xml");
  const shared: string[] = [];
  if (sharedXml) {
    const $ = await loadXml(load, sharedXml);
    $("si").each((_, element) => {
      // One shared string can be several runs (`<r><t>` per formatting run);
      // joined without a separator, because the runs are one word split by a
      // colour change as often as they are two words.
      shared.push($(element).find("t").toArray().map((t) => $(t).text()).join(""));
    });
  }

  const names = await sheetNames(parts, load);
  const blocks: string[] = [];
  for (const [index, sheet] of names.entries()) {
    const xml = parts.read(sheet.path);
    if (!xml) continue;
    const $ = await loadXml(load, xml);
    const rows: string[] = [];
    $("row").each((_, row) => {
      const cells = $(row)
        .find("c")
        .toArray()
        .map((cell) => {
          const $cell = $(cell);
          const type = $cell.attr("t");
          if (type === "s") {
            const at = Number.parseInt($cell.find("v").first().text(), 10);
            return shared[at] ?? "";
          }
          if (type === "inlineStr") {
            return $cell.find("is t").toArray().map((t) => $(t).text()).join("");
          }
          return $cell.find("v").first().text();
        });
      // A row of nothing is a row of formatting; it says nothing to a reader.
      if (cells.some((cell) => cell.trim())) rows.push(cells.join("\t"));
    });
    if (rows.length === 0) continue;
    blocks.push(`## ${sheet.name || `Sheet ${index + 1}`}\n${rows.join("\n")}`);
  }
  return blocks.join("\n\n");
}

/**
 * Each sheet's display name paired with the part that holds it.
 *
 * The workbook lists sheets by relationship id, and the relationship file maps
 * those to paths. Reading both is what keeps "Q3 actuals" attached to the right
 * grid; pairing document order with `sheet1.xml`, `sheet2.xml` happens to work
 * until somebody reorders a workbook, and then it silently mislabels every
 * sheet, which is worse than not naming them.
 */
async function sheetNames(
  parts: NonNullable<ReturnType<typeof partLoader>>,
  load: Cheerio["load"]
): Promise<Array<{ name: string; path: string }>> {
  const workbook = parts.read("xl/workbook.xml");
  const relsXml = parts.read("xl/_rels/workbook.xml.rels");
  if (!workbook || !relsXml) {
    // No map: fall back to every worksheet part, in name order, unnamed.
    return parts.entries
      .filter((entry) => entry.name.startsWith("xl/worksheets/sheet"))
      .sort((a, b) => a.name.localeCompare(b.name, "en", { numeric: true }))
      .map((entry) => ({ name: "", path: entry.name }));
  }
  const $rels = await loadXml(load, relsXml);
  const targets = new Map<string, string>();
  $rels("Relationship").each((_, element) => {
    const id = $rels(element).attr("Id");
    const target = $rels(element).attr("Target");
    if (id && target) targets.set(id, target.replace(/^\/?xl\//, ""));
  });
  const $book = await loadXml(load, workbook);
  const sheets: Array<{ name: string; path: string }> = [];
  $book("sheet").each((_, element) => {
    const name = $book(element).attr("name") ?? "";
    const id = $book(element).attr("r:id") ?? $book(element).attr("id");
    const target = id ? targets.get(id) : undefined;
    if (target) sheets.push({ name, path: `xl/${target}` });
  });
  return sheets;
}

/** A deck as text: one block per slide, in slide order. */
async function pptxText(bytes: Uint8Array): Promise<string> {
  const parts = partLoader(bytes);
  if (!parts) return "";
  const { load } = await import("cheerio");
  const slides = parts.entries
    .filter((entry) => /^ppt\/slides\/slide\d+\.xml$/.test(entry.name))
    .sort((a, b) => a.name.localeCompare(b.name, "en", { numeric: true }));

  const blocks: string[] = [];
  for (const [index, slide] of slides.entries()) {
    const xml = parts.read(slide.name);
    if (!xml) continue;
    const $ = await loadXml(load, xml);
    // `a:t` is the text run in DrawingML, wherever it sits: a title, a bullet,
    // a text box, a table cell. Taking every one in document order is what
    // keeps a slide readable without modelling its layout.
    const lines = $("a\\:t, t")
      .toArray()
      .map((element) => $(element).text().trim())
      .filter(Boolean);
    if (lines.length === 0) continue;
    blocks.push(`## Slide ${index + 1}\n${lines.join("\n")}`);
  }
  return blocks.join("\n\n");
}

/**
 * Text from an OOXML package, or "" when this is not a shape this reader knows.
 * The caller decides what an empty answer means; here it is never an exception,
 * because a deck of nothing but images is a real deck.
 */
export async function ooxmlText(
  bytes: Uint8Array,
  extension: "xlsx" | "pptx"
): Promise<string> {
  return extension === "xlsx" ? xlsxText(bytes) : pptxText(bytes);
}
