/**
 * The bottom-right ingestion card: what a crawl or an Application Import is
 * doing right now, while it is doing it.
 *
 * The console already had two ways to learn that knowledge was being built: the
 * Library table's per-row status pill, which only exists on that page, and a
 * `crawl` Alert, which only arrives once the thing has already failed. Between
 * starting a crawl and its Alert there was nothing, so an admin who navigated
 * away had no way to tell a slow crawl from a stuck one.
 *
 * This module is the pure half: the shapes the poll returns, the merge that
 * turns a sequence of polls into one stable list, and the copy. The React card
 * and its polling live in `components/notifications/ingestion-activity-card.tsx`,
 * the server read in `lib/ingestion-activity-read.ts`.
 */

export type IngestionItemStatus = "queued" | "running" | "indexed" | "failed";

/** Run ids are prefixed so a tally can be read back without a second field. */
export const WEBSITE_PREFIX = "website:";
export const IMPORT_PREFIX = "import:";

/**
 * What a run counts. A crawl counts **pages**, because pages are what it brings
 * into Ciele and its single website row would otherwise report "0/1" for
 * twenty minutes. An Import counts the documents it maps, one per row.
 */
export type IngestionUnit = "page" | "item";

/** One row on the card: a website being crawled, or one imported document. */
export interface IngestionActivityItem {
  /** The Source id. Stable across polls, which is what makes the merge work. */
  id: string;
  name: string;
  status: IngestionItemStatus;
  /** Right-hand detail: "Crawling", "128 pages", or the failure message. */
  detail?: string;
}

/** One crawl or Import the card is following, tallied by the server. */
export interface IngestionRun {
  /** `website:<sourceId>` or `import:<importId>`. */
  id: string;
  title: string;
  unit: IngestionUnit;
  /** Progress in `unit`. A `total` of 0 means it is not known yet. */
  done: number;
  total: number;
  /** Rows this run has, and how many of them reached a terminal state. */
  rows: number;
  rowsDone: number;
  /** Rows that failed. */
  failed: number;
  /** A capped sample of the rows: failures first, then the queue. */
  items: IngestionActivityItem[];
}

/** One poll's answer. */
export interface IngestionActivitySnapshot {
  runs: IngestionRun[];
}

type RunTally = Omit<IngestionRun, "items">;

interface TrackedItem extends IngestionActivityItem {
  /** Which run's tally this row belongs to. */
  runId: string;
  /** Epoch ms the item first reported a terminal status, for the linger. */
  settledAt: number | null;
}

export interface IngestionActivityState {
  items: TrackedItem[];
  /** Import ids seen in flight, so a finished Import is still asked about. */
  importIds: string[];
  runs: Record<string, RunTally>;
  /** Set by the user; the card stays down until unseen work arrives. */
  dismissedAt: number | null;
  /** The runs that were on the card when it was dismissed. */
  dismissedRuns: string[];
}

/** Rows the card shows at once. Four, because more is a page, not a card. */
export const VISIBLE_ITEM_LIMIT = 4;

/**
 * How long a finished run stays on screen. Long enough to read the outcome,
 * short enough that it is gone before it becomes furniture. A run with a
 * failure never auto-clears, the same rule the notification banner applies to
 * anything the user may have to act on.
 */
export const SETTLED_LINGER_MS = 12_000;

const TERMINAL: ReadonlySet<IngestionItemStatus> = new Set(["indexed", "failed"]);

export function isTerminal(status: IngestionItemStatus): boolean {
  return TERMINAL.has(status);
}

export function emptyIngestionActivity(): IngestionActivityState {
  return { items: [], importIds: [], runs: {}, dismissedAt: null, dismissedRuns: [] };
}

/**
 * Ids the next poll has to ask about by name.
 *
 * A Source that finishes leaves the "processing" query the moment it does, so
 * asking only that query would show work vanishing rather than succeeding.
 * These are the ids the card is still following; the server resolves each one
 * even when it is no longer in flight.
 */
export function trackedIngestionIds(state: IngestionActivityState): {
  sources: string[];
  imports: string[];
} {
  return {
    sources: state.items.filter((item) => !isTerminal(item.status)).map((item) => item.id),
    imports: state.importIds,
  };
}

/**
 * Folds one poll into the card's list.
 *
 * Items keep their identity across polls (same Source id, same row), terminal
 * items keep the moment they settled so the linger is measured from the first
 * poll that saw the outcome rather than from the last one, and an item that
 * disappears entirely (its Source was deleted mid-crawl) is dropped.
 */
export function mergeIngestionSnapshot(
  state: IngestionActivityState,
  snapshot: IngestionActivitySnapshot,
  now: number,
): IngestionActivityState {
  const settledAt = new Map(
    state.items.map((item) => [item.id, item.settledAt] as const),
  );
  const incoming: TrackedItem[] = snapshot.runs.flatMap((run) =>
    run.items.map((item) => ({
      ...item,
      runId: run.id,
      settledAt: isTerminal(item.status) ? (settledAt.get(item.id) ?? now) : null,
    })),
  );

  // A row the server stopped reporting while the card was still following it
  // is kept at its last known state until the linger expires, so a settled
  // outcome is never yanked off the card by the next poll.
  const seen = new Set(incoming.map((item) => item.id));
  const held = state.items.filter((item) => !seen.has(item.id) && lingers(item, now));

  const runs: Record<string, RunTally> = {};
  for (const run of snapshot.runs) {
    runs[run.id] = {
      id: run.id,
      title: run.title,
      unit: run.unit,
      done: run.done,
      total: run.total,
      rows: run.rows,
      rowsDone: run.rowsDone,
      failed: run.failed,
    };
  }
  // Keep the tally of a run whose rows are only being held: its numbers are
  // what the header is still counting.
  const heldRuns = new Set(held.map((item) => item.runId));
  for (const [id, tally] of Object.entries(state.runs)) {
    if (!(id in runs) && heldRuns.has(id)) runs[id] = tally;
  }

  const importIds = [
    ...new Set([
      ...snapshot.runs
        .filter((run) => run.id.startsWith(IMPORT_PREFIX))
        .map((run) => run.id.slice(IMPORT_PREFIX.length)),
      // An Import whose own row went quiet but whose documents are still being
      // ingested stays on the list; the next poll is how we learn it finished.
      ...state.importIds.filter((id) => `${IMPORT_PREFIX}${id}` in runs),
    ]),
  ];

  // A dismissal is about the runs that were on the card, not about ingestion in
  // general: hiding a twenty-minute crawl must not be undone by that same
  // crawl's next poll, and the next thing somebody starts must not stay hidden
  // behind it. So a run the dismissal never saw re-opens the card.
  const arrived = Object.keys(runs).some(
    (id) => !state.dismissedRuns.includes(id),
  );
  const dismissed = state.dismissedAt !== null && !arrived;

  return {
    items: orderIngestionItems([...incoming, ...held]),
    importIds,
    runs,
    dismissedAt: dismissed ? state.dismissedAt : null,
    dismissedRuns: dismissed ? state.dismissedRuns : [],
  };
}

/**
 * Whether a settled row is still worth showing. A failure has no expiry: it is
 * the one outcome somebody has to do something about, so it waits to be
 * dismissed, exactly as an error notification does.
 */
function lingers(item: TrackedItem, now: number): boolean {
  if (item.settledAt === null) return false;
  if (item.status === "failed") return true;
  return now - item.settledAt < SETTLED_LINGER_MS;
}

/** Failures first (they need a person), then live work, then the queue. */
const STATUS_ORDER: Record<IngestionItemStatus, number> = {
  failed: 0,
  running: 1,
  indexed: 2,
  queued: 3,
};

export function orderIngestionItems<T extends IngestionActivityItem>(items: T[]): T[] {
  return [...items].sort(
    (a, b) =>
      STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.name.localeCompare(b.name),
  );
}

/** Drops rows whose linger has expired; the card closes when nothing is left. */
export function expireIngestionActivity(
  state: IngestionActivityState,
  now: number,
): IngestionActivityState {
  const items = state.items.filter(
    (item) => item.settledAt === null || lingers(item, now),
  );
  if (items.length === state.items.length) return state;
  const alive = new Set(items.map((item) => item.runId));
  return {
    ...state,
    items,
    runs: Object.fromEntries(
      Object.entries(state.runs).filter(([id]) => alive.has(id)),
    ),
  };
}

/**
 * Puts the card away without forgetting the run.
 *
 * Dismissing a crawl that is still going does not cancel it, so the state stays
 * and the poll carries on: the only thing that changes is that the card renders
 * nothing until work the dismissal never saw arrives.
 */
export function dismissIngestionActivity(
  state: IngestionActivityState,
  now: number,
): IngestionActivityState {
  return { ...state, dismissedAt: now, dismissedRuns: Object.keys(state.runs) };
}

/**
 * True while a poll is still worth making.
 *
 * The tallies decide it, not the rows: an Import ships a sample, and a run with
 * 30 documents still queued can perfectly well have four indexed ones on the
 * card. A row that is not terminal settles it either way.
 */
export function ingestionActivityBusy(state: IngestionActivityState): boolean {
  return (
    state.items.some((item) => !isTerminal(item.status)) ||
    Object.values(state.runs).some((run) => run.rowsDone < run.rows)
  );
}

export interface IngestionActivityCardModel {
  title: string;
  /** "261/291", or null while there is no denominator worth showing. */
  count: string | null;
  done: number;
  total: number;
  /** The rows to render, already ordered and capped. */
  items: IngestionActivityItem[];
  /** Rows the card is not showing: the "+30 queued" footer. */
  overflow: number;
  failed: number;
  busy: boolean;
}

/**
 * What the card renders, or null when there is nothing to say.
 *
 * Two different quantities, computed apart because they are different
 * questions. The header counts the run in its own unit, pages for a crawl and
 * documents for an Import, from the server's tally rather than from the rows
 * under it. The footer counts **rows** the card is not showing, which is not
 * the same number whenever a run's unit is not its row.
 */
export function ingestionActivityCard(
  state: IngestionActivityState,
  options: { limit?: number } = {},
): IngestionActivityCardModel | null {
  if (state.items.length === 0 || state.dismissedAt !== null) return null;
  const runs = Object.values(state.runs);
  if (runs.length === 0) return null;
  const limit = options.limit ?? VISIBLE_ITEM_LIMIT;

  const units = new Set(runs.map((run) => run.unit));
  const progress =
    units.size === 1
      ? { done: sum(runs, (run) => run.done), total: sum(runs, (run) => run.total) }
      : // Pages and documents do not add up, so a mixed card counts the one
        // thing every run agrees on: its rows.
        { done: sum(runs, (run) => run.rowsDone), total: sum(runs, (run) => run.rows) };
  const failed = sum(runs, (run) => run.failed);
  const busy = ingestionActivityBusy(state);

  const items = state.items.slice(0, limit);
  const shownPending = items.filter((item) => !isTerminal(item.status)).length;
  const pendingRows = sum(runs, (run) => run.rows - run.rowsDone);

  return {
    title: ingestionTitle(runs, { busy, ...progress, failed }),
    count: progress.total > 1 ? `${progress.done}/${progress.total}` : null,
    done: progress.done,
    total: progress.total,
    items,
    overflow: Math.max(0, pendingRows - shownPending),
    failed,
    busy,
  };
}

function sum<T>(items: T[], value: (item: T) => number): number {
  return items.reduce((total, item) => total + value(item), 0);
}

function ingestionTitle(
  runs: RunTally[],
  run: { busy: boolean; total: number; done: number; failed: number },
): string {
  const crawls = runs.filter((entry) => entry.unit === "page").length;

  if (crawls === runs.length) {
    if (runs.length === 1) {
      const [only] = runs;
      return run.busy ? `Crawling ${only.title}` : `Crawled ${only.title}`;
    }
    return run.busy
      ? `Crawling ${runs.length} websites`
      : `Crawled ${runs.length} websites`;
  }

  if (crawls === 0) {
    const noun = run.total === 1 ? "item" : "items";
    if (run.busy) return `Importing ${run.total} ${noun}`;
    if (run.failed > 0) {
      return `Imported ${run.done - run.failed} of ${run.total} ${noun}`;
    }
    return `Imported ${run.total} ${noun}`;
  }

  const noun = run.total === 1 ? "source" : "sources";
  return run.busy ? `Indexing ${run.total} ${noun}` : `Indexed ${run.total} ${noun}`;
}

/** Row copy: the status pill on the right of each row. */
export function ingestionStatusLabel(status: IngestionItemStatus): string {
  switch (status) {
    case "queued":
      return "Queued";
    case "running":
      return "Running";
    case "indexed":
      return "Indexed";
    case "failed":
      return "Failed";
  }
}
