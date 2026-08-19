/**
 * Source text extraction: the front half of the knowledge-ingestion
 * pipeline: turn what the admin gave us (pasted text, a URL, an uploaded
 * file) into plain text ready for OKF enrichment (`ingest.ts`).
 *
 * One Extractor per SourceKind, dispatched through the EXTRACTORS registry,
 * the same pattern as the Flow Action handler registry (`actions.ts`).
 * Adding an ingestable kind (LMS course content, an Applications connector,
 * EdTech guide packs) is one Extractor + one registry entry.
 */

import { egressFetch } from "./egress";

const URL_FETCH_TIMEOUT_MS = 30_000;
const URL_FETCH_MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const URL_FETCH_MAX_REDIRECTS = 3;

export type ExtractInput =
  | { kind: "text"; name: string; text: string }
  | { kind: "url"; url: string }
  | { kind: "file"; name: string; bytes: ArrayBuffer };

export interface ExtractedSource {
  /** Display name for the Source row (page title for URLs, filename for files). */
  name: string;
  /** Plain text ready for OKF enrichment. */
  text: string;
}

type ExtractorFor<K extends ExtractInput["kind"]> = (
  input: Extract<ExtractInput, { kind: K }>
) => Promise<ExtractedSource>;

/** Minimal structural view of a parsed DOM node (cheerio/domhandler). */
interface DomNode {
  type: string;
  data?: string;
  children?: DomNode[];
}

/** Collects entity-decoded text nodes, space-separated so block boundaries
 *  never jam words together ("<p>a</p><p>b</p>" → "a b"). */
function collectText(node: DomNode, parts: string[]): void {
  if (node.type === "text" && node.data) parts.push(node.data);
  if (node.children) for (const child of node.children) collectText(child, parts);
}

/** HTML → plain text via a real parser: drops script/style/noscript/template
 *  (and comments/CDATA correctly), decodes entities, extracts the title. */
export async function htmlToText(html: string): Promise<{ title: string; text: string }> {
  const { load } = await import("cheerio");
  const $ = load(html);
  const title = $("title").first().text().replace(/\s+/g, " ").trim();
  $("script, style, noscript, template, iframe").remove();
  const body = $("body");
  const nodes = (
    body.length ? body.toArray() : $.root().toArray()
  ) as unknown as DomNode[];
  const parts: string[] = [];
  for (const node of nodes) collectText(node, parts);
  const text = parts.join(" ").replace(/\s+/g, " ").trim();
  return { title, text };
}

export const EXTRACTORS: { [K in ExtractInput["kind"]]: ExtractorFor<K> } = {
  async text(input) {
    return { name: input.name.trim() || "Pasted text", text: input.text };
  },

  async url(input) {
    const { response } = await egressFetch(input.url, {
      timeoutMs: URL_FETCH_TIMEOUT_MS,
      maxResponseBytes: URL_FETCH_MAX_RESPONSE_BYTES,
      maxRedirects: URL_FETCH_MAX_REDIRECTS,
      headers: { "user-agent": "agent-hub" },
    });
    if (!response.ok) throw new Error(`Fetch failed (${response.status})`);
    const { title, text } = await htmlToText(response.text);
    if (!text) throw new Error("No text could be extracted from the page");
    return { name: title || input.url, text };
  },

  async file(input) {
    const lower = input.name.toLowerCase();
    let text: string;
    if (lower.endsWith(".pdf")) {
      const { extractText } = await import("unpdf");
      const extracted = await extractText(new Uint8Array(input.bytes), { mergePages: true });
      text = extracted.text;
    } else if (lower.endsWith(".docx")) {
      const mammoth = await import("mammoth");
      const result = await mammoth.extractRawText({ buffer: Buffer.from(input.bytes) });
      text = result.value;
    } else {
      text = new TextDecoder().decode(input.bytes);
    }
    if (!text.trim()) throw new Error("No text could be extracted from the file");
    return { name: input.name, text };
  },
};

/** The one extraction entrypoint: dispatches to the Extractor for the input's kind. */
export async function extractSourceText(input: ExtractInput): Promise<ExtractedSource> {
  const extractor = EXTRACTORS[input.kind] as (i: ExtractInput) => Promise<ExtractedSource>;
  return extractor(input);
}
