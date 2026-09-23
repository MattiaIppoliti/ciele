import type {
  SourceDocumentSort,
  SourceDocumentStatus,
  SourceKind,
} from "@agent-hub/core";
import type { BadgeTone } from "@agent-hub/ui";
import { knowledgeTabForKind } from "@/lib/knowledge-hub";

/**
 * Pure derivations for a Source's Documents route (#927): where the link goes,
 * what the URL says, and how the Updated column reads. Server- and
 * client-safe; the route and its components stay thin over these.
 */

export interface SourceDocumentsSearchParams {
  page: number;
  /** Oldest first. The Updated column defaults to newest first. */
  ascending: boolean;
  /** Which header was clicked; "" is the default, when it was stored. */
  sort: "" | SourceDocumentSort;
  /** The Status header's filter; "" is every state. */
  status: "" | SourceDocumentStatus;
}

/**
 * The Status badge's colour, one map for the two surfaces that draw it: the
 * Documents table and a Document's own header.
 *
 * The same three-tone reading the Library gives a Source, so a reader
 * crossing from one table to the other does not have to relearn the palette:
 * green is answering, amber is on its way. Excluded is `gray` rather than a
 * warning colour because it is a choice an admin made, not something that
 * went wrong, and red beside it would read as a failed page.
 */
const DOCUMENT_STATUS_TONE: Record<SourceDocumentStatus, BadgeTone> = {
  ready: "green",
  pending: "amber",
  excluded: "gray",
};

export function sourceDocumentTone(status: SourceDocumentStatus): BadgeTone {
  return DOCUMENT_STATUS_TONE[status];
}

const DOCUMENT_SORTS: SourceDocumentSort[] = ["createdAt", "title"];
const DOCUMENT_STATUSES: SourceDocumentStatus[] = [
  "ready",
  "pending",
  "excluded",
];

/** Parses + clamps the route's URL params; garbage falls back to defaults. */
export function parseSourceDocumentsParams(
  params: Record<string, string | string[] | undefined>
): SourceDocumentsSearchParams {
  const one = (v: string | string[] | undefined): string =>
    (Array.isArray(v) ? v[0] : v) ?? "";
  const page = Number.parseInt(one(params.page), 10);
  const column = one(params.column);
  const status = one(params.status);
  return {
    page: Number.isFinite(page) && page >= 1 ? page : 1,
    // `sort=oldest` predates the clickable headers and is still what the
    // Updated column writes, so it keeps its spelling; `column` is the newer
    // half and names which header the direction applies to.
    ascending: one(params.sort) === "oldest",
    sort: (DOCUMENT_SORTS as string[]).includes(column)
      ? (column as SourceDocumentSort)
      : "",
    status: (DOCUMENT_STATUSES as string[]).includes(status)
      ? (status as SourceDocumentStatus)
      : "",
  };
}

/**
 * Where a Source's name links to from the Library. The tab is in the path, so
 * the browser's back button returns to the tab the reader came from and a
 * shared link opens the same place.
 */
export function libraryDocumentsHref(kind: SourceKind, sourceId: string): string {
  return `/library/${knowledgeTabForKind(kind)}/${sourceId}`;
}

/** The same route inside an Assistant's Knowledge section. */
export function assistantDocumentsHref(
  assistantId: string,
  sourceId: string
): string {
  return `/assistants/${assistantId}/knowledge/${sourceId}`;
}

/**
 * The query string that names a place in the table: page and sort, with the
 * defaults left out so page one newest-first is the bare route. Empty when
 * there is nothing to say.
 */
export function sourceDocumentsQuery(
  params: SourceDocumentsSearchParams,
  page: number = params.page
): string {
  const query = new URLSearchParams();
  if (page > 1) query.set("page", String(page));
  if (params.ascending) query.set("sort", "oldest");
  if (params.sort) query.set("column", params.sort);
  if (params.status) query.set("status", params.status);
  return query.toString();
}

/**
 * Where a header click goes. Choosing a column or a direction returns to page
 * one, because page four of the old order is a different set of rows in the
 * new one; a filter does the same, for the same reason.
 */
export function sourceDocumentsParamsHref(
  base: string,
  params: SourceDocumentsSearchParams,
  patch: Partial<SourceDocumentsSearchParams>
): string {
  return sourceDocumentsPageHref(base, { ...params, ...patch }, 1);
}

/** One page's href, keeping whatever sort the reader chose. */
export function sourceDocumentsPageHref(
  base: string,
  params: SourceDocumentsSearchParams,
  page: number
): string {
  const suffix = sourceDocumentsQuery(params, page);
  return suffix ? `${base}?${suffix}` : base;
}

/**
 * A Document row's href (#928). It carries the table's page and sort, so the
 * Document route's breadcrumb can return to the same place in the table
 * rather than to page one of the default order.
 */
export function sourceDocumentHref(
  base: string,
  documentId: string,
  params: SourceDocumentsSearchParams
): string {
  return sourceDocumentsPageHref(`${base}/${documentId}`, params, params.page);
}

/**
 * The Updated header's href: flips the sort and returns to page 1, because
 * page 4 of the old order is a different set of rows in the new one.
 */
export function sourceDocumentsSortHref(
  base: string,
  params: SourceDocumentsSearchParams
): string {
  return sourceDocumentsParamsHref(base, params, {
    ascending: !params.ascending,
  });
}

/**
 * "3 minutes ago" for the Updated column, beside an absolute `title`. It takes
 * `now` rather than reading the clock, so the cell hydrates against the same
 * instant the server rendered.
 */
export function relativeTimeLabel(iso: string, now: Date = new Date()): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const seconds = Math.max(0, Math.round((now.getTime() - then) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} month${months === 1 ? "" : "s"} ago`;
  const years = Math.floor(days / 365);
  return `${years} year${years === 1 ? "" : "s"} ago`;
}
