import type { SourceDocumentListItem } from "./types";

/**
 * What a Source's Documents table says about one Document (#927).
 *
 * Three states, derived at read time and never stored, because all three are
 * already facts about other columns:
 *
 * - `excluded` an admin kept this page out of retrieval (`0008_website_config`)
 * - `pending`  stored, not yet chunked: it exists but cannot be found yet
 * - `ready`    stored, chunked, answering
 *
 * Excluded wins over pending: an excluded Document is never going to be
 * chunked, so reporting it as "on its way" would be a wrong promise rather
 * than a fresher fact.
 */
export type SourceDocumentStatus = "ready" | "excluded" | "pending";

export function sourceDocumentStatus(
  document: Pick<SourceDocumentListItem, "excluded" | "indexed">
): SourceDocumentStatus {
  if (document.excluded) return "excluded";
  return document.indexed ? "ready" : "pending";
}

/** The pill's label. One place, so the table and any later surface agree. */
export function sourceDocumentStatusLabel(status: SourceDocumentStatus): string {
  switch (status) {
    case "ready":
      return "Ready";
    case "excluded":
      return "Excluded";
    case "pending":
      return "Pending";
  }
}

/** How many Documents one page of the table holds. */
export const SOURCE_DOCUMENTS_PAGE_SIZE = 50;

/** How many chunks one page of the Chunks tab holds (#929). */
export const DOCUMENT_CHUNKS_PAGE_SIZE = 50;
