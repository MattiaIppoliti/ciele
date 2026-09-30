import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FindDetailRequest, FindPreviewData, FindRecord, FindRecordsResult } from "./find-index";
import { createFindStore, createPointerAim } from "./find-store";

// The store's timings, as `find-store.ts` sets them: a list is fresh for 20 s,
// a detail for 60 s, a failure is retried after 8 s, a highlight waits 60 ms
// and a warm 120 ms. Fake timers drive `Date.now` and `setTimeout` alike.
beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

const advance = (ms: number) => vi.advanceTimersByTime(ms);

const record = (id: string): FindRecord => ({
  key: `assistant:${id}`,
  id,
  kind: "assistant",
  title: id,
  subtitle: "",
  snippet: "",
  href: `/assistants/${id}`,
  updatedAt: "2026-09-29T10:00:00.000Z",
  facts: [],
});

const detail = (summary: string): FindPreviewData => ({
  summary,
  stats: [],
  items: [],
  links: [],
  linksLabel: "Open",
  messages: [],
});

const flush = () => vi.advanceTimersByTimeAsync(0);

const whole = (records: FindRecordsResult["records"]): FindRecordsResult => ({ records, partial: false });

/** A detail request for a key; the store only reads `key`, the server the rest. */
const req = (key: string): FindDetailRequest => ({ key, kind: "assistant", id: key });

/**
 * `loadDetails` built from a per-key answer, recording every batch it is asked
 * for. A key whose answer throws is left out of the batch's result, which is how
 * the server reports one failed read without failing the rest.
 */
function details(answer: (key: string) => Promise<FindPreviewData | null>) {
  const batches: string[][] = [];
  const loadDetails = async (requests: FindDetailRequest[]) => {
    batches.push(requests.map((r) => r.key));
    const out: Record<string, FindPreviewData | null> = {};
    await Promise.all(
      requests.map(async (r) => {
        try {
          out[r.key] = await answer(r.key);
        } catch {
          // left out: a failure for this key alone
        }
      })
    );
    return out;
  };
  return { batches, loadDetails };
}

describe("createFindStore: the record list", () => {
  it("loads on first open, then serves the cached list and refreshes only when stale", async () => {
    let loads = 0;
    const store = createFindStore({
      loadDetails: async () => ({}),
      loadRecords: async () => whole([record(`r${++loads}`)]),
    });
    expect(store.getSnapshot().records).toBeNull();
    store.open();
    await flush();
    expect(store.getSnapshot().records!.map((r) => r.id)).toEqual(["r1"]);

    advance(10_000);
    store.open(); // fresh: no reload
    await flush();
    expect(loads).toBe(1);

    advance(10_001);
    store.open(); // stale: reload, but the old list keeps showing meanwhile
    expect(store.getSnapshot().records!.map((r) => r.id)).toEqual(["r1"]);
    await flush();
    expect(store.getSnapshot().records!.map((r) => r.id)).toEqual(["r2"]);
  });

  it("shares one load between a prefetch and the open that follows it", async () => {
    let loads = 0;
    const store = createFindStore({
      loadDetails: async () => ({}),
      loadRecords: async () => {
        loads += 1;
        return whole([record("a")]);
      },
    });
    store.prefetch();
    store.open();
    await flush();
    expect(loads).toBe(1);
  });

  it("keeps the last good list and reports an error when a refresh fails", async () => {
    let fail = false;
    const store = createFindStore({
      loadDetails: async () => ({}),
      loadRecords: async () => {
        if (fail) throw new Error("down");
        return whole([record("a")]);
      },
    });
    store.open();
    await flush();
    fail = true;
    advance(20_001);
    store.open();
    await flush();
    const snap = store.getSnapshot();
    expect(snap.records!.map((r) => r.id)).toEqual(["a"]);
    expect(snap.recordsStatus).toBe("error");
  });

  it("tells subscribers when the snapshot changes and stops when they leave", async () => {
    const store = createFindStore({ loadDetails: async () => ({}), loadRecords: async () => whole([record("a")]) });
    let calls = 0;
    const off = store.subscribe(() => (calls += 1));
    store.open();
    await flush();
    expect(calls).toBeGreaterThan(0);
    off();
    const seen = calls;
    store.open();
    await flush();
    expect(calls).toBe(seen);
  });
});

describe("createFindStore: a row's detail", () => {
  it("waits for the row to be looked at before fetching, and skips one arrowed past", async () => {
    const d = details(async (key) => detail(key));
    const store = createFindStore({
      loadRecords: async () => whole([]),
      loadDetails: d.loadDetails,
    });
    store.highlight(req("a"));
    advance(30);
    store.highlight(req("b")); // moved on before 60ms: "a" is never fetched
    advance(100);
    await flush();
    expect(d.batches).toEqual([["b"]]);
    expect(store.getSnapshot().details.get("b")).toEqual(detail("b"));
    expect(store.getSnapshot().details.has("a")).toBe(false);
  });

  it("warms the rows most likely to be looked at in one request, so the look is instant", async () => {
    const d = details(async (key) => detail(key));
    const store = createFindStore({
      loadRecords: async () => whole([]),
      loadDetails: d.loadDetails,
    });
    store.warm([req("a"), req("b"), req("c")]);
    advance(120);
    await flush();
    expect(d.batches).toEqual([["a", "b", "c"]]);
    store.highlight(req("b"));
    advance(100);
    await flush();
    expect(d.batches).toHaveLength(1); // already held: no second request
    expect(store.getSnapshot().details.get("b")).toEqual(detail("b"));
  });

  it("coalesces warm calls made while typing into the last one, and asks only for what it lacks", async () => {
    const d = details(async (key) => detail(key));
    const store = createFindStore({
      loadRecords: async () => whole([]),
      loadDetails: d.loadDetails,
    });
    store.warm([req("a")]);
    advance(20);
    store.warm([req("a"), req("b")]);
    advance(120);
    await flush();
    store.warm([req("a"), req("b"), req("c")]);
    advance(120);
    await flush();
    expect(d.batches).toEqual([["a", "b"], ["c"]]);
  });

  it("warms at most a screenful at once", async () => {
    const d = details(async (key) => detail(key));
    const store = createFindStore({
      loadRecords: async () => whole([]),
      loadDetails: d.loadDetails,
    });
    store.warm(Array.from({ length: 40 }, (_, i) => req(`k${i}`)));
    advance(120);
    await flush();
    expect(d.batches[0]!.length).toBeLessThanOrEqual(12);
  });

  it("does not ask again for a row already on its way", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const d = details(async (key) => {
      await gate;
      return detail(key);
    });
    const store = createFindStore({
      loadRecords: async () => whole([]),
      loadDetails: d.loadDetails,
    });
    store.warm([req("a")]);
    advance(120);
    await flush();
    store.highlight(req("a"));
    advance(60);
    release();
    await flush();
    expect(d.batches).toEqual([["a"]]);
  });

  it("does not fetch a row it already has, across a close and reopen", async () => {
    let loads = 0;
    const d = details(async () => detail(`v${++loads}`));
    const store = createFindStore({
      loadRecords: async () => whole([]),
      loadDetails: d.loadDetails,
    });
    store.highlight(req("a"));
    advance(60);
    await flush();
    store.cancelHighlight();
    store.highlight(req("a"));
    advance(60);
    await flush();
    expect(loads).toBe(1);
  });

  it("refetches a stale row but keeps showing the old detail while it loads", async () => {
    let loads = 0;
    const d = details(async () => detail(`v${++loads}`));
    const store = createFindStore({
      loadRecords: async () => whole([]),
      loadDetails: d.loadDetails,
    });
    store.highlight(req("a"));
    advance(60);
    await flush();
    advance(60_001);
    store.highlight(req("a"));
    expect(store.getSnapshot().details.get("a")).toEqual(detail("v1"));
    advance(60);
    await flush();
    expect(store.getSnapshot().details.get("a")).toEqual(detail("v2"));
  });

  it("records a failed fetch as nothing more to say, and retries after a short while", async () => {
    let calls = 0;
    const d = details(async () => {
      calls += 1;
      if (calls === 1) throw new Error("boom");
      return detail("ok");
    });
    const store = createFindStore({
      loadRecords: async () => whole([]),
      loadDetails: d.loadDetails,
    });
    store.highlight(req("a"));
    advance(60);
    await flush();
    expect(store.getSnapshot().details.get("a")).toBeNull();
    store.highlight(req("a")); // still inside the failure window: no retry
    advance(60);
    await flush();
    expect(calls).toBe(1);
    advance(8_001);
    store.highlight(req("a"));
    advance(60);
    await flush();
    expect(store.getSnapshot().details.get("a")).toEqual(detail("ok"));
  });

  it("treats a whole batch that fails as a failure of every row in it", async () => {
    const store = createFindStore({
      loadRecords: async () => whole([]),
      loadDetails: async () => {
        throw new Error("down");
      },
    });
    store.warm([req("a"), req("b")]);
    advance(120);
    await flush();
    expect(store.getSnapshot().details.get("a")).toBeNull();
    expect(store.getSnapshot().details.get("b")).toBeNull();
  });

  it("does not let a slow answer for a row that was left land on top of a newer one", async () => {
    let releaseA!: () => void;
    const gateA = new Promise<void>((r) => (releaseA = r));
    const d = details(async (key) => {
      if (key === "a") await gateA;
      return detail(key);
    });
    const store = createFindStore({
      loadRecords: async () => whole([]),
      loadDetails: d.loadDetails,
    });
    store.highlight(req("a"));
    advance(60);
    store.highlight(req("b"));
    advance(60);
    await flush();
    releaseA();
    await flush();
    // "a" still lands under its own key (it is correct for "a"), "b" is intact.
    expect(store.getSnapshot().details.get("b")).toEqual(detail("b"));
    expect(store.getSnapshot().details.get("a")).toEqual(detail("a"));
  });
});

describe("createPointerAim", () => {
  /** The preview pane: to the right of the list, from x = 600, y 100..700. */
  const PREVIEW = { left: 600, top: 100, bottom: 700 };

  function aim() {
    const applied: number[] = [];
    const pointer = createPointerAim({ delayMs: 140, target: () => PREVIEW });
    return { applied, pointer, apply: (i: number) => applied.push(i) };
  }

  it("switches at once when the pointer moves up or down the list", () => {
    const { pointer, apply, applied } = aim();
    pointer.move(1, 0, 200, 300, apply);
    pointer.move(2, 1, 202, 340, apply);
    pointer.move(3, 2, 201, 380, apply);
    expect(applied).toEqual([1, 2, 3]);
  });

  it("holds the selection while the pointer heads for the preview across other rows", () => {
    const { pointer, apply, applied } = aim();
    pointer.move(1, 0, 200, 300, apply);
    expect(applied).toEqual([1]);
    // Diagonal toward the preview, crossing rows 2 and 3 on the way.
    pointer.move(2, 1, 260, 320, apply);
    pointer.move(3, 1, 320, 340, apply);
    advance(100);
    expect(applied).toEqual([1]);
  });

  it("gives the row under the pointer the selection once it stops heading anywhere", () => {
    const { pointer, apply, applied } = aim();
    pointer.move(1, 0, 200, 300, apply);
    pointer.move(3, 1, 300, 340, apply);
    advance(139);
    expect(applied).toEqual([1]);
    advance(2);
    expect(applied).toEqual([1, 3]);
  });

  it("switches at once when a move turns away from the preview", () => {
    const { pointer, apply, applied } = aim();
    pointer.move(1, 0, 200, 300, apply);
    pointer.move(2, 1, 260, 320, apply); // heading right: held
    pointer.move(3, 1, 258, 360, apply); // now straight down: switch
    expect(applied).toEqual([1, 3]);
  });

  it("switches at once when there is no preview to aim at", () => {
    const applied: number[] = [];
    const pointer = createPointerAim({ delayMs: 140, target: () => null });
    pointer.move(1, 0, 200, 300, (i) => applied.push(i));
    pointer.move(2, 1, 300, 320, (i) => applied.push(i));
    expect(applied).toEqual([1, 2]);
  });

  it("drops a held switch when the pointer leaves the list, or the keyboard moves", () => {
    const { pointer, apply, applied } = aim();
    pointer.move(1, 0, 200, 300, apply);
    pointer.move(2, 1, 260, 320, apply);
    pointer.leave();
    advance(500);
    pointer.move(1, 1, 200, 300, apply);
    pointer.move(2, 1, 260, 320, apply);
    pointer.cancel();
    advance(500);
    expect(applied).toEqual([1]);
  });

  it("does nothing for the row that is already active", () => {
    const { pointer, apply, applied } = aim();
    pointer.move(0, 0, 200, 300, apply);
    expect(applied).toEqual([]);
  });
});

describe("createFindStore: failure, partial answers and identity", () => {
  it("does not let a load that was in flight at invalidate pass for fresh", async () => {
    let loads = 0;
    let release!: () => void;
    const store = createFindStore({
      loadDetails: async () => ({}),
      loadRecords: () =>
        new Promise((resolve) => {
          const n = ++loads;
          release = () => resolve(whole([record(`r${n}`)]));
        }),
    });
    store.open();
    await flush();
    store.invalidate();
    release();
    await flush();
    expect(store.getSnapshot().records!.map((r) => r.id)).toEqual(["r1"]);
    store.open();
    await flush();
    expect(loads).toBe(2);
  });

  it("invalidate keeps what it shows but reloads the list and details on the next look", async () => {
    let loads = 0;
    let detailLoads = 0;
    const d = details(async () => detail(`d${++detailLoads}`));
    const store = createFindStore({
      loadRecords: async () => whole([record(`r${++loads}`)]),
      loadDetails: d.loadDetails,
    });
    store.open();
    await flush();
    store.highlight(req("r1"));
    advance(60);
    await flush();

    store.invalidate();
    expect(store.getSnapshot().records!.map((r) => r.id)).toEqual(["r1"]);
    expect(store.getSnapshot().details.get("r1")!.summary).toBe("d1");

    store.open();
    await flush();
    expect(store.getSnapshot().records!.map((r) => r.id)).toEqual(["r2"]);
    store.highlight(req("r1"));
    advance(60);
    await flush();
    expect(store.getSnapshot().details.get("r1")!.summary).toBe("d2");
  });

  it("shows a partial list but refreshes it soon, instead of holding it for the full ttl", async () => {
    let loads = 0;
    const store = createFindStore({
      loadDetails: async () => ({}),
      loadRecords: async () => ({ records: [record(`r${++loads}`)], partial: loads === 1 }),
    });
    store.open();
    await flush();
    expect(store.getSnapshot().records!.map((r) => r.id)).toEqual(["r1"]);
    expect(store.getSnapshot().recordsStatus).toBe("partial");
    advance(8_100); // well inside the 20 s ttl, but past the 8 s retry window
    store.open();
    await flush();
    expect(store.getSnapshot().records!.map((r) => r.id)).toEqual(["r2"]);
    expect(store.getSnapshot().recordsStatus).toBe("ready");
  });

  it("does not let a pointer resting on a button refire a failing load, but lets a press retry", async () => {
    let loads = 0;
    const store = createFindStore({
      loadDetails: async () => ({}),
      loadRecords: async () => {
        loads += 1;
        throw new Error("down");
      },
    });
    store.open();
    await flush();
    expect(loads).toBe(1);
    store.prefetch(); // inside the backoff window: skipped
    store.prefetch();
    await flush();
    expect(loads).toBe(1);
    store.open(); // a person opening the palette always gets a try
    await flush();
    expect(loads).toBe(2);
    advance(8_001);
    store.prefetch(); // backoff is over
    await flush();
    expect(loads).toBe(3);
  });

  it("forgets everything on reset, and ignores an answer that was in flight for the old identity", async () => {
    let release!: (r: FindRecordsResult) => void;
    let first = true;
    const store = createFindStore({
      loadDetails: async () => ({}),
      loadRecords: () =>
        first
          ? ((first = false), new Promise<FindRecordsResult>((r) => (release = r)))
          : Promise.resolve(whole([record("new")])),
    });
    store.open();
    store.reset(); // the Member or Organization changed
    expect(store.getSnapshot().records).toBeNull();
    store.open();
    await flush();
    expect(store.getSnapshot().records!.map((r) => r.id)).toEqual(["new"]);
    release(whole([record("old")])); // the stale answer lands late
    await flush();
    expect(store.getSnapshot().records!.map((r) => r.id)).toEqual(["new"]);
  });

  it("does not fetch a highlighted row after the palette has closed", async () => {
    let asked = 0;
    const store = createFindStore({
      loadRecords: async () => whole([]),
      loadDetails: details(async () => (asked++, detail("a"))).loadDetails,
    });
    store.highlight(req("a"));
    store.cancelHighlight();
    advance(500);
    await flush();
    expect(asked).toBe(0);
  });

  it("can fetch a key again after a load threw before returning a promise", async () => {
    let calls = 0;
    const store = createFindStore({
      loadRecords: async () => whole([]),
      loadDetails: (() => {
        calls += 1;
        if (calls === 1) throw new Error("sync");
        return Promise.resolve({ a: detail("ok") });
      }) as never,
    });
    store.highlight(req("a"));
    advance(60);
    await flush();
    advance(8_001);
    store.highlight(req("a"));
    advance(60);
    await flush();
    expect(store.getSnapshot().details.get("a")).toEqual(detail("ok"));
  });

  it("retries a partial detail soon instead of keeping it for the full ttl", async () => {
    let n = 0;
    const d = details(async (): Promise<FindPreviewData> => ({
      ...detail(`v${++n}`),
      ...(n === 1 ? { partial: true as const } : {}),
    }));
    const store = createFindStore({
      loadRecords: async () => whole([]),
      loadDetails: d.loadDetails,
    });
    store.highlight(req("a"));
    advance(60);
    await flush();
    advance(8_100);
    store.highlight(req("a"));
    advance(60);
    await flush();
    expect(store.getSnapshot().details.get("a")!.summary).toBe("v2");
  });
});
