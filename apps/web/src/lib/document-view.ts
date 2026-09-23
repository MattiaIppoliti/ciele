import type { SourceKind } from "@agent-hub/core";

/**
 * Pure derivations for the Document route (#928): its tabs, the Details
 * column's wording and the Excerpt. Tested here because vitest ignores `.tsx`.
 */

export const DOCUMENT_TABS = ["memories", "content", "chunks"] as const;
export type DocumentTab = (typeof DOCUMENT_TABS)[number];

/**
 * Which tab a URL asks for. **Content is the default** while Memories has
 * nothing to show (#928): opening on an empty tab reads as a broken page.
 * When #932 fills Memories, the default moves there.
 */
export function parseDocumentTab(
  value: string | string[] | undefined
): DocumentTab {
  const one = (Array.isArray(value) ? value[0] : value) ?? "";
  return (DOCUMENT_TABS as readonly string[]).includes(one)
    ? (one as DocumentTab)
    : "content";
}

/**
 * A tab's href. The default tab stays out of the URL. `listQuery` is the
 * Documents table's page and sort (`sourceDocumentsQuery`), carried along so
 * switching tabs does not lose the breadcrumb's place in the table.
 */
export function documentTabHref(
  basePath: string,
  tab: DocumentTab,
  listQuery = ""
): string {
  const parts = [tab === "content" ? "" : `tab=${tab}`, listQuery].filter(Boolean);
  return parts.length === 0 ? basePath : `${basePath}?${parts.join("&")}`;
}

/** The Details column's "how it got here", per Source kind. */
export function documentOrigin(kind: SourceKind): string {
  switch (kind) {
    case "website":
    case "url":
      return "Crawl";
    case "file":
      return "Upload";
    case "text":
      return "Pasted text";
    case "faq":
      return "FAQ";
    case "application":
      return "Import";
  }
}

/**
 * The Excerpt card's body: the first paragraph, capped.
 *
 * Not a summary and never labelled one. It skips a leading markdown heading,
 * because "# Leave policy" is the title the reader is already looking at, and
 * it cuts at a word boundary so the card never ends mid-word.
 */
export function documentExcerpt(body: string, limit = 280): string {
  const paragraph = body
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .find((block) => block.length > 0 && !/^#{1,6}\s/.test(block));
  if (!paragraph) return "";
  const flat = paragraph.replace(/\s+/g, " ");
  if (flat.length <= limit) return flat;
  const cut = flat.slice(0, limit);
  const lastSpace = cut.lastIndexOf(" ");
  return `${cut.slice(0, lastSpace > limit / 2 ? lastSpace : limit)}…`;
}
