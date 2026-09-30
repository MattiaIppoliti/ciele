import { describePage, type PageLink, type PageShortcuts } from "@/lib/find-pages";
import { FIND_KIND_INFO, type FindKind } from "@/lib/find-kinds";
import { fuzzyMatch } from "@/lib/fuzzy";

/**
 * The record shape behind the Find palette: one row per thing a Member can
 * open, whatever table it came from. The server flattens assistants,
 * conversations, improvements, help desks and teammates into this, and
 * everything after that (filtering, recency groups, the preview) is pure and
 * lives here, so it can be tested in node.
 */
export { FIND_KIND_INFO, FIND_KINDS, isFindKind, type FindKind } from "@/lib/find-kinds";

export interface FindRecord {
  /** `${kind}:${id}`, unique across kinds. */
  key: string;
  kind: FindKind;
  /** The record's own id, what the detail read is keyed by. */
  id: string;
  /** An improvement's board status (`to_do`, `in_review`...); absent on every other kind. */
  status?: string;
  title: string;
  /** Where it lives: the assistant a conversation belongs to, a status line. */
  subtitle: string;
  /** A line or two of body text, searched unless "Title only" is on. */
  snippet: string;
  href: string;
  /** ISO timestamp; drives the Today / Past 30 days / Older groups. */
  updatedAt: string;
  /**
   * Label / value pairs the preview shows straight away. Only what the list
   * read already carries: nothing here costs a request.
   */
  facts: Array<{ label: string; value: string }>;
}

/**
 * The little extra a preview fetches for the one row that is highlighted, a
 * conversation's first question, a help desk's channels. Loaded on demand and
 * cached, never for the whole list, so the palette stays quick to open and to
 * arrow through.
 */
export interface FindPreviewData {
  /** A line or two that says what is inside. */
  summary: string | null;
  stats: Array<{ label: string; value: string }>;
  /** What it contains, shown as chips or rows (channels, collections), each opening where it lives. */
  items: PageLink[];
  /** The same idea for things that open something when clicked. */
  links: PageLink[];
  /** What the links are called on the page ("Flows", "Recent runs"). */
  linksLabel: string;
  /** A conversation's opening question and latest answer, drawn as bubbles. */
  messages: Array<{ role: "user" | "assistant"; text: string }>;
  /**
   * Some of the reads behind this failed or ran out of time, so it is missing
   * pieces. It is shown, but neither the server nor the client keeps it for
   * long, so the next look asks again.
   */
  partial?: true;
}

/** The record list, and whether every kind was read. */
export interface FindRecordsResult {
  records: FindRecord[];
  /** A kind's read failed, so its rows are missing rather than empty. */
  partial: boolean;
}

export type FindUpdated = "any" | "today" | "week" | "month";

export const FIND_UPDATED_LABELS: Record<FindUpdated, string> = {
  any: "Any time",
  today: "Today",
  week: "Past 7 days",
  month: "Past 30 days",
};

export interface FindFilters {
  query: string;
  titleOnly: boolean;
  /** null: every kind. */
  kind: FindKind | null;
  updated: FindUpdated;
}

export const EMPTY_FIND_FILTERS: FindFilters = {
  query: "",
  titleOnly: false,
  kind: null,
  updated: "any",
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** Start of the local day containing `now`. */
function startOfDay(now: Date): number {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

export type RecencyGroup = "Today" | "Past 30 days" | "Older";

/**
 * The bucket Notion-style recents sort into. Unparseable dates read as Older.
 * A list sorted newest first (`filterFindRecords`) reads Today, Past 30 days,
 * Older top to bottom, so each bucket is one run of rows.
 */
export function recencyGroup(iso: string, now: Date): RecencyGroup {
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return "Older";
  if (at >= startOfDay(now)) return "Today";
  if (at >= now.getTime() - 30 * DAY_MS) return "Past 30 days";
  return "Older";
}

function withinUpdated(iso: string, updated: FindUpdated, now: Date): boolean {
  if (updated === "any") return true;
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return false;
  if (updated === "today") return at >= startOfDay(now);
  return at >= now.getTime() - (updated === "week" ? 7 : 30) * DAY_MS;
}

/** Newest first; a record with no usable date sinks. */
function byRecency(a: FindRecord, b: FindRecord): number {
  const at = Date.parse(a.updatedAt);
  const bt = Date.parse(b.updatedAt);
  return (Number.isNaN(bt) ? 0 : bt) - (Number.isNaN(at) ? 0 : at);
}

export function filterFindRecords(
  records: readonly FindRecord[],
  filters: FindFilters,
  now: Date = new Date()
): FindRecord[] {
  const q = filters.query.trim();
  return records
    .filter((record) => {
      if (filters.kind && record.kind !== filters.kind) return false;
      if (!withinUpdated(record.updatedAt, filters.updated, now)) return false;
      if (!q) return true;
      if (fuzzyMatch(q, record.title)) return true;
      if (filters.titleOnly) return false;
      // Body text matches by substring. The typo-tolerant subsequence match
      // that suits a short title matches almost any paragraph ("support"
      // is a subsequence of most sentences), which buries the real hits.
      const needle = q.toLowerCase();
      return (
        record.subtitle.toLowerCase().includes(needle) ||
        record.snippet.toLowerCase().includes(needle)
      );
    })
    .sort(byRecency);
}

/** A card written into a page preview: a name, a line about it and where it goes. */
export interface FindPageCard extends PageLink {
  text: string;
}

/** One kanban lane in a page preview: its name and the entries on it. */
export interface FindPageLane {
  label: string;
  entries: PageLink[];
}

/** What a page preview writes into its layout, drawn from the list already read. */
export interface FindPageContent {
  cards: FindPageCard[];
  lanes: FindPageLane[];
  /** Labelled rows of links to what the page leads to (its tabs, an assistant to open it in). */
  shortcuts: PageShortcuts[];
  /** A list page's rows. */
  rows: PageLink[];
}

export const NO_PAGE_CONTENT: FindPageContent = { cards: [], lanes: [], shortcuts: [], rows: [] };

/** The kanban lane an Improvement status belongs to. */
function laneFor(status: string | undefined): string | null {
  if (status === "to_do") return "To do";
  if (status === "in_progress" || status === "in_review") return "In progress";
  if (status === "done") return "Done";
  return null;
}

const LANES = ["To do", "In progress", "Done"];

/**
 * What a console page holds, for its preview: the first few records' names and
 * descriptions, taken from the list the palette has already read, so the
 * preview shows real cards, kanban titles and inbox rows without asking for
 * anything. What to fill from is the page's registry entry (`find-pages.ts`),
 * so a page with nothing behind it in the index returns nothing and keeps its
 * grey blocks.
 */
export function pageContent(href: string, records: readonly FindRecord[]): FindPageContent {
  const page = describePage(href);
  if (!page) return NO_PAGE_CONTENT;

  if (page.shortcuts) return { ...NO_PAGE_CONTENT, shortcuts: [page.shortcuts] };

  const fill = page.fill;
  if (fill && "cards" in fill) {
    return {
      ...NO_PAGE_CONTENT,
      cards: records
        .filter((record) => record.kind === fill.cards)
        .slice(0, 4)
        .map((record) => ({
          title: record.title,
          text: record.snippet,
          href: record.href,
        })),
    };
  }

  if (fill && "lanes" in fill) {
    const lanes: FindPageLane[] = LANES.map((label) => ({ label, entries: [] }));
    for (const record of records) {
      if (record.kind !== "improvement") continue;
      const lane = lanes.find((l) => l.label === laneFor(record.status));
      if (lane && lane.entries.length < 2) {
        lane.entries.push({ title: record.title, href: record.href });
      }
    }
    return { ...NO_PAGE_CONTENT, lanes };
  }

  if (fill && "rows" in fill) {
    return {
      ...NO_PAGE_CONTENT,
      rows: records
        .filter((record) => record.kind === fill.rows)
        .slice(0, 5)
        .map((record) => ({ title: record.title, href: record.href })),
    };
  }

  // A SETUP section opened from the picker belongs to no assistant yet, so it
  // offers to open in each one. A scoped link already is one.
  if (page.setupSlug && !page.assistantId) {
    const links = records
      .filter((record) => record.kind === "assistant")
      .slice(0, 6)
      .map((record) => ({ title: record.title, href: `${record.href}/${page.setupSlug}` }));
    return links.length > 0
      ? { ...NO_PAGE_CONTENT, shortcuts: [{ label: "Open in", links }] }
      : NO_PAGE_CONTENT;
  }

  return NO_PAGE_CONTENT;
}

/** Whether a click or key press asks for a new tab: Cmd on macOS, Ctrl elsewhere. */
export const opensInNewTab = (event: { metaKey: boolean; ctrlKey: boolean }): boolean =>
  event.metaKey || event.ctrlKey;

/** How many records the palette lists before anything narrows the search. */
export const RECENTS_LIMIT = 12;

/**
 * The list to show for records already filtered and sorted newest first. With
 * no query and no filter it is the few most recent, the way a recents list
 * reads and the fewest rows to build and to arrow through. Any query or filter
 * lifts the cap, because then the person is looking for something in particular.
 */
export function recentsView(
  filtered: readonly FindRecord[],
  filters: FindFilters
): readonly FindRecord[] {
  const narrowed =
    filters.query.trim() !== "" ||
    filters.titleOnly ||
    filters.kind !== null ||
    filters.updated !== "any";
  return narrowed ? filtered : filtered.slice(0, RECENTS_LIMIT);
}

/** The key a page's detail is cached under: one per route, so scoped SETUP links never collide. */
const pageKey = (href: string): string => `page:${href}`;

/**
 * What the preview of one row reads beyond the list, described as data so the
 * store can put several rows into one request: a record's detail, or a console
 * page's live numbers. `key` is where the answer is kept.
 */
export type FindDetailRequest =
  | { key: string; kind: FindKind; id: string }
  | { key: string; href: string };

/**
 * The one rule for whether a row has anything to read beyond the list: a
 * record whose kind has a detail, or a page whose registry entry is live.
 * Null for everything else, which the preview then draws from what it has.
 */
export function detailRequest(row: {
  record: Pick<FindRecord, "key" | "kind" | "id"> | null;
  href: string;
}): FindDetailRequest | null {
  if (row.record) {
    const { key, kind, id } = row.record;
    return FIND_KIND_INFO[kind].detail ? { key, kind, id } : null;
  }
  return describePage(row.href)?.live ? { key: pageKey(row.href), href: row.href } : null;
}

/**
 * Who the palette answers for: Organization, Member and Role. What it shows
 * depends on all three (a private Teammate is its owner's alone, API key counts
 * are admins' alone), so the browser store drops what it holds when this changes.
 */
export const findScopeKey = (scope: { organizationId: string; userId: string; role: string | null }) =>
  `${scope.organizationId}:${scope.userId}:${scope.role ?? "none"}`;
