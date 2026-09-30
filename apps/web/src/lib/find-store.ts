import type {
  FindDetailRequest,
  FindPreviewData,
  FindRecord,
  FindRecordsResult,
} from "@/lib/find-index";

/**
 * The Find palette's client-side state that is not about what is on screen:
 * the record list, the per-row detail, and how eagerly each is fetched.
 *
 * Both are derived state (the Db is the record of truth), so both are treated
 * as such. They are kept between openings and served **stale while they
 * refresh**, so the palette opens on the last list at once and a row seen
 * before shows its detail with no wait. The rows most likely to be looked at
 * next (the first screenful, the neighbours of the active one) are warmed in
 * one request, so looking at one is usually instant. A row asked for on its
 * own waits a beat first so arrowing past it costs nothing, a fetch is never
 * repeated while one is in flight, and a failure is remembered briefly so a
 * broken read is not hammered.
 *
 * Callers describe what they want as data (`FindDetailRequest`), never as a
 * closure, which is what lets the store put several rows into one request.
 *
 * Plain state behind a subscribe/snapshot pair, on `Date.now` and `setTimeout`,
 * so the policy (what is reused, when, and what a failure does) is tested in
 * node under fake timers. `useSyncExternalStore` is the only React that touches it.
 */

/**
 * `partial`: a list is showing but a kind is missing from it, so it is refreshed
 * soon. `error`: the last load failed, whatever list there is (maybe none) is
 * the last good one.
 */
export type FindStatus = "idle" | "loading" | "ready" | "partial" | "error";

export interface FindSnapshot {
  /** The list, or null before the first one has loaded. Kept across a failed refresh. */
  records: FindRecord[] | null;
  recordsStatus: FindStatus;
  /**
   * A row's detail by record key, or page key. Present with a value once loaded,
   * present as null when the read found nothing more to say or failed. Absent
   * means not asked yet. May be stale while a refresh is in flight.
   */
  details: ReadonlyMap<string, FindPreviewData | null>;
}

export interface FindStoreDeps {
  loadRecords: () => Promise<FindRecordsResult>;
  /**
   * The detail of several rows in one request, by key. A key missing from the
   * answer is a failed read for that row; a rejection fails every row asked.
   */
  loadDetails: (requests: FindDetailRequest[]) => Promise<Record<string, FindPreviewData | null>>;
}

export interface FindStore {
  subscribe(listener: () => void): () => void;
  getSnapshot(): FindSnapshot;
  /** The palette opened: load the list if there is none or it is stale. Always retries a failure. */
  open(): void;
  /** A pointer rests on a control that is about to open the palette: warm the list, but not into a failure. */
  prefetch(): void;
  /** A row is highlighted: fetch its detail once it has been looked at for a moment, unless it is held. */
  highlight(request: FindDetailRequest): void;
  /**
   * Rows likely to be looked at next, most likely first: fetch the ones not held
   * (at most `WARM_LIMIT`) together, once the list has stopped changing.
   */
  warm(requests: readonly FindDetailRequest[]): void;
  /** Drop a pending highlight fetch, for when the palette closes. */
  cancelHighlight(): void;
  /** The Member or Organization changed: forget everything and ignore what is in flight. */
  reset(): void;
  /**
   * Something may have changed (a mutation refreshed the shell): keep showing
   * what is held, but reload the list on the next open and a row's detail the
   * next time it is looked at.
   */
  invalidate(): void;
}

/**
 * Most rows one warm request asks for: about a screenful. Rows held fresh are
 * left out, so a reopen inside `DETAIL_TTL_MS` asks for nothing.
 */
export const WARM_LIMIT = 12;

/** A list older than this is refreshed on the next open. */
const RECORDS_TTL_MS = 20_000;
/** A row's detail older than this is refetched when it is looked at again. */
const DETAIL_TTL_MS = 60_000;
/** How long a row must be highlighted before its detail is fetched on its own. */
const DETAIL_DEBOUNCE_MS = 60;
/** How long a warm request waits for the list to stop changing (typing). */
const WARM_DELAY_MS = 120;
/**
 * After a failed or partial read, how long before it is tried again, and how
 * long a pointer resting on the Find button is kept from refiring a failing load.
 */
const FAILURE_TTL_MS = 8_000;

/** Runs `fn` after `ms` and returns a cancel. */
const schedule = (fn: () => void, ms: number) => {
  const id = setTimeout(fn, ms);
  return () => clearTimeout(id);
};

export function createFindStore(deps: FindStoreDeps): FindStore {
  let records: FindRecord[] | null = null;
  let recordsAt = 0;
  let recordsStatus: FindStatus = "idle";
  let recordsInflight: Promise<void> | null = null;
  let recordsFailedAt = -Infinity;
  /** Bumped by `reset`: an answer that started under an older one is dropped. */
  let generation = 0;
  /**
   * Bumped by `invalidate`: an answer that started under an older one is still
   * shown (it belongs to this Member) but is stored as already stale, so the
   * next look reads again instead of trusting what predates the change.
   */
  let epoch = 0;

  const entries = new Map<string, { data: FindPreviewData | null; at: number }>();
  const inflight = new Set<string>();
  let cancelPending: (() => void) | null = null;
  let cancelWarm: (() => void) | null = null;

  let snapshot: FindSnapshot = { records, recordsStatus, details: new Map() };
  const listeners = new Set<() => void>();

  function publish() {
    snapshot = {
      records,
      recordsStatus,
      details: new Map([...entries].map(([key, entry]) => [key, entry.data])),
    };
    for (const listener of listeners) listener();
  }

  function loadRecords(manual: boolean) {
    if (recordsInflight) return;
    if (records && recordsStatus !== "partial" && recordsStatus !== "error" && Date.now() - recordsAt < RECORDS_TTL_MS) {
      return;
    }
    // A partial list is refreshed after the short window, not the long ttl.
    if (records && recordsStatus === "partial" && Date.now() - recordsAt < FAILURE_TTL_MS) return;
    // A failing load is not refired by a pointer resting on a button. A person
    // opening the palette always gets a try.
    if (!manual && Date.now() - recordsFailedAt < FAILURE_TTL_MS) return;
    recordsStatus = records ? recordsStatus : "loading";
    publish();
    const started = generation;
    const startedEpoch = epoch;
    recordsInflight = Promise.resolve()
      .then(deps.loadRecords)
      .then((result) => {
        if (started !== generation) return;
        records = result.records;
        recordsAt = startedEpoch === epoch ? Date.now() : -Infinity;
        recordsStatus = result.partial ? "partial" : "ready";
      })
      .catch(() => {
        if (started !== generation) return;
        // Keep the last good list on screen. The status says it is out of date.
        recordsStatus = "error";
        recordsFailedAt = Date.now();
      })
      .finally(() => {
        if (started === generation) recordsInflight = null;
        publish();
      });
  }

  function fresh(key: string): boolean {
    const entry = entries.get(key);
    return entry !== undefined && Date.now() - entry.at < DETAIL_TTL_MS;
  }

  /** Worth asking for: not held fresh and not already on its way. */
  function wanted(key: string): boolean {
    return !fresh(key) && !inflight.has(key);
  }

  function fetchDetails(requests: FindDetailRequest[]) {
    const asked = requests.filter((r) => wanted(r.key));
    if (asked.length === 0) return;
    for (const r of asked) inflight.add(r.key);
    const started = generation;
    const startedEpoch = epoch;
    const failed = (key: string) => {
      // A failure is remembered for `FAILURE_TTL_MS`, shorter than a success, so a
      // broken read is retried soon but not on every arrow key. Old detail
      // stays if there was some.
      entries.set(key, {
        data: entries.get(key)?.data ?? null,
        at: Date.now() - DETAIL_TTL_MS + FAILURE_TTL_MS,
      });
    };
    Promise.resolve()
      .then(() => deps.loadDetails(asked))
      .then((answers) => {
        if (started !== generation) return;
        for (const { key } of asked) {
          if (!Object.hasOwn(answers, key)) {
            failed(key);
            continue;
          }
          const data = answers[key] ?? null;
          // A partial answer is shown but retried after the short window, and
          // one that began before an invalidate is stored as stale.
          entries.set(key, {
            data,
            at:
              startedEpoch !== epoch
                ? -Infinity
                : data?.partial
                  ? Date.now() - DETAIL_TTL_MS + FAILURE_TTL_MS
                  : Date.now(),
          });
        }
      })
      .catch(() => {
        if (started !== generation) return;
        for (const { key } of asked) failed(key);
      })
      .finally(() => {
        if (started === generation) for (const { key } of asked) inflight.delete(key);
        publish();
      });
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => snapshot,
    open: () => loadRecords(true),
    prefetch: () => loadRecords(false),
    cancelHighlight() {
      cancelPending?.();
      cancelPending = null;
      cancelWarm?.();
      cancelWarm = null;
    },
    reset() {
      generation += 1;
      cancelPending?.();
      cancelPending = null;
      cancelWarm?.();
      cancelWarm = null;
      records = null;
      recordsAt = 0;
      recordsStatus = "idle";
      recordsInflight = null;
      recordsFailedAt = -Infinity;
      entries.clear();
      inflight.clear();
      publish();
    },
    invalidate() {
      epoch += 1;
      recordsAt = -Infinity;
      for (const entry of entries.values()) entry.at = -Infinity;
    },
    highlight(request) {
      cancelPending?.();
      cancelPending = null;
      if (!wanted(request.key)) return;
      cancelPending = schedule(() => {
        cancelPending = null;
        fetchDetails([request]);
      }, DETAIL_DEBOUNCE_MS);
    },
    warm(requests) {
      cancelWarm?.();
      const batch = requests.filter((r) => wanted(r.key)).slice(0, WARM_LIMIT);
      if (batch.length === 0) {
        cancelWarm = null;
        return;
      }
      cancelWarm = schedule(() => {
        cancelWarm = null;
        fetchDetails(batch);
      }, WARM_DELAY_MS);
    },
  };
}

/**
 * Which row a moving pointer makes active, for a list whose active row drives
 * a pane beside it (the preview).
 *
 * The row under the pointer becomes active at once: waiting on every row made
 * the whole list feel slow to follow the hand. The exception is the one move
 * that must not steal the selection, heading from a row to the pane across the
 * rows in between. That move points into the triangle between where the
 * pointer was and the pane's near edge, so while the pointer keeps heading
 * there the switch is held, and it lands after `delayMs` only if the pointer
 * stops on a row instead of reaching the pane (the "menu aim" of a mega-menu).
 *
 * Pure geometry over the coordinates it is given, on `setTimeout`;
 * `target` reports the pane's near edge, or null when there is no pane.
 */
export function createPointerAim(options: {
  delayMs: number;
  target: () => { left: number; top: number; bottom: number } | null;
}) {
  let cancelPending: (() => void) | null = null;
  let last: { x: number; y: number } | null = null;

  function cancel() {
    cancelPending?.();
    cancelPending = null;
  }

  /** Whether the move from `from` to `to` heads into the pane's near edge. */
  function aiming(from: { x: number; y: number }, to: { x: number; y: number }): boolean {
    const pane = options.target();
    if (!pane || to.x <= from.x || to.x >= pane.left) return false;
    // The move's slope must fall between the slopes from `from` to the pane's
    // top and bottom corners: the direction lies inside that triangle.
    const run = to.x - from.x;
    const slope = (to.y - from.y) / run;
    const toTop = (pane.top - from.y) / (pane.left - from.x);
    const toBottom = (pane.bottom - from.y) / (pane.left - from.x);
    return slope >= toTop && slope <= toBottom;
  }

  return {
    /** The pointer is at (x, y) over row `index`, while row `current` is active. */
    move(index: number, current: number, x: number, y: number, apply: (index: number) => void) {
      const from = last;
      last = { x, y };
      if (index === current) return cancel();
      cancel();
      if (from && aiming(from, last)) {
        cancelPending = schedule(() => {
          cancelPending = null;
          apply(index);
        }, options.delayMs);
        return;
      }
      apply(index);
    },
    /** The pointer left the list. */
    leave() {
      cancel();
      last = null;
    },
    /** Something else (the keyboard) moved the selection. */
    cancel,
  };
}
