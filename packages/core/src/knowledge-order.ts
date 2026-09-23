import type {
  OrgKnowledgeSourceSort,
  SourceDocumentSort,
  SourceStatus,
} from "./types";

/**
 * The orders the two paged knowledge tables can be read in.
 *
 * Both reads exist twice, as SQL and as an in-memory adapter, and the Library
 * read exists a third time as the adapter-side fallback its RPC drops to
 * during a deploy window. The comparators are here so the three agree by
 * construction: a table whose SQL and mock orders disagree looks correct in
 * every test and wrong on the second page in production.
 *
 * They are total orders, not partial ones. Paging a set whose order has ties
 * loses rows: two Sources written in the same millisecond can swap places
 * between page one and page two, and one of them is then never shown. The id
 * is the last key of every comparator for exactly that reason.
 */

export interface OrgKnowledgeSourceOrder {
  sort?: OrgKnowledgeSourceSort;
  ascending?: boolean;
}

/** Ordinal for the Status column, so "ready" and "error" sort as states. */
const STATUS_RANK: Record<SourceStatus, number> = {
  error: 0,
  processing: 1,
  ready: 2,
};

function text(a: string, b: string): number {
  return a.toLowerCase().localeCompare(b.toLowerCase());
}

function descend(value: number): number {
  return -value;
}

export function compareOrgKnowledgeSources(
  order: OrgKnowledgeSourceOrder
): (
  a: {
    id: string;
    name: string;
    status: SourceStatus;
    createdAt: string;
    updatedAt?: string;
  },
  b: {
    id: string;
    name: string;
    status: SourceStatus;
    createdAt: string;
    updatedAt?: string;
  }
) => number {
  const ascending = order.ascending ?? false;
  const face = (value: number) => (ascending ? value : descend(value));
  return (a, b) => {
    let primary: number;
    switch (order.sort) {
      case "name":
        primary = text(a.name, b.name);
        break;
      case "status":
        primary = STATUS_RANK[a.status] - STATUS_RANK[b.status];
        break;
      case "updatedAt":
        primary = text(a.updatedAt ?? a.createdAt, b.updatedAt ?? b.createdAt);
        break;
      // "createdAt", nothing, and anything the URL invented: when the row was
      // added, descending unless asked otherwise, which is the order every
      // caller got before the headers were clickable.
      default:
        primary = text(a.createdAt, b.createdAt);
    }
    // The tie-break follows the chosen direction, or flipping a sort leaves
    // ties where they were and the flip stops looking like one. The same key
    // list, in the same direction, is what `get_org_knowledge_source_page`
    // orders by; a tie-break that disagreed with it would order the Library
    // one way through the RPC and the other through the mock Db and the
    // schema-lag fallback.
    return (
      face(primary) ||
      face(text(a.createdAt, b.createdAt)) ||
      face(text(a.id, b.id))
    );
  };
}

export interface SourceDocumentOrder {
  sort?: SourceDocumentSort;
  ascending?: boolean;
}

export function compareSourceDocuments(
  order: SourceDocumentOrder
): (
  a: { id: string; title: string; createdAt: string },
  b: { id: string; title: string; createdAt: string }
) => number {
  const ascending = order.ascending ?? false;
  const face = (value: number) => (ascending ? value : descend(value));
  return (a, b) => {
    const primary =
      order.sort === "title"
        ? text(a.title, b.title)
        : text(a.createdAt, b.createdAt);
    // Title, then createdAt, then id, each following the chosen direction:
    // the exact key list `get_source_document_page` orders by. Under the
    // default sort the second key is the first one over again and costs
    // nothing; under "title" it is what keeps two "Untitled" pages in the
    // order the database would have put them in.
    return (
      face(primary) ||
      face(text(a.createdAt, b.createdAt)) ||
      face(text(a.id, b.id))
    );
  };
}
