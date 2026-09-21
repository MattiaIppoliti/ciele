import { describe, expect, it } from "vitest";
import {
  SETTLED_LINGER_MS,
  VISIBLE_ITEM_LIMIT,
  dismissIngestionActivity,
  emptyIngestionActivity,
  expireIngestionActivity,
  ingestionActivityBusy,
  ingestionActivityCard,
  mergeIngestionSnapshot,
  orderIngestionItems,
  trackedIngestionIds,
  type IngestionActivityItem,
  type IngestionActivitySnapshot,
  type IngestionRun,
} from "@/lib/ingestion-activity";

const T0 = Date.parse("2026-09-20T10:00:00.000Z");

/** One crawl: a website row, counted in pages. */
function crawl(
  id: string,
  status: IngestionActivityItem["status"],
  pages: { done?: number; total?: number; detail?: string } = {},
): IngestionRun {
  const done = pages.done ?? 0;
  const total = pages.total ?? 0;
  return {
    id: `website:${id}`,
    title: `${id}.example`,
    unit: "page",
    done,
    total: Math.max(total, done),
    rows: 1,
    rowsDone: status === "running" ? 0 : 1,
    failed: status === "failed" ? 1 : 0,
    items: [{ id, name: `${id}.example`, status, detail: pages.detail }],
  };
}

function snapshot(runs: IngestionRun[]): IngestionActivitySnapshot {
  return { runs };
}

/**
 * One Import of `total` documents, `done` of them settled. The sample mimics
 * the server's: failures first, then the queue, then what is already indexed.
 */
function importRun(total: number, done: number, failed = 0): IngestionRun {
  const statuses: IngestionActivityItem["status"][] = [];
  for (let i = 0; i < total; i += 1) {
    statuses.push(i < failed ? "failed" : i < done ? "indexed" : "queued");
  }
  const rank = { failed: 0, queued: 1, indexed: 2, running: 3 };
  const items = statuses
    .map((status, i) => ({ id: `doc-${i}`, name: `doc-${i}.md`, status }))
    .sort((a, b) => rank[a.status] - rank[b.status])
    .slice(0, 6);
  return {
    id: "import:imp-1",
    title: "ServiceNow",
    unit: "item",
    done,
    total,
    rows: total,
    rowsDone: done,
    failed,
    items,
  };
}

describe("merge", () => {
  it("keeps a row's identity across polls and stamps when it settled", () => {
    const first = mergeIngestionSnapshot(
      emptyIngestionActivity(),
      snapshot([crawl("docs", "running")]),
      T0,
    );
    expect(first.items).toHaveLength(1);
    expect(first.items[0].settledAt).toBeNull();

    const second = mergeIngestionSnapshot(
      first,
      snapshot([crawl("docs", "indexed", { done: 12, total: 12, detail: "12 pages" })]),
      T0 + 5_000,
    );
    expect(second.items).toHaveLength(1);
    expect(second.items[0].detail).toBe("12 pages");

    // A later poll that still reports it must not move the clock forward, or
    // the row would never expire.
    const third = mergeIngestionSnapshot(
      second,
      snapshot([crawl("docs", "indexed", { done: 12, total: 12, detail: "12 pages" })]),
      T0 + 9_000,
    );
    expect(third.items[0].settledAt).toBe(T0 + 5_000);
  });

  it("holds a settled row the server stopped reporting, until its linger ends", () => {
    const seen = mergeIngestionSnapshot(
      emptyIngestionActivity(),
      snapshot([crawl("docs", "indexed", { done: 4, total: 4 })]),
      T0,
    );
    const quiet = mergeIngestionSnapshot(seen, snapshot([]), T0 + 1_000);
    expect(quiet.items).toHaveLength(1);
    expect(quiet.runs["website:docs"]).toMatchObject({ unit: "page", rows: 1, rowsDone: 1 });

    const later = mergeIngestionSnapshot(
      quiet,
      snapshot([]),
      T0 + SETTLED_LINGER_MS + 1,
    );
    expect(later.items).toHaveLength(0);
    expect(later.runs).toEqual({});
  });

  it("keeps a failure on screen however long it takes somebody to read it", () => {
    const failed = mergeIngestionSnapshot(
      emptyIngestionActivity(),
      snapshot([crawl("docs", "failed", { detail: "403 from the host" })]),
      T0,
    );
    const hourLater = expireIngestionActivity(failed, T0 + 3_600_000);
    expect(hourLater.items).toHaveLength(1);
    expect(hourLater.items[0].detail).toBe("403 from the host");
  });

  it("asks the next poll only about what is still in flight", () => {
    const state = mergeIngestionSnapshot(
      emptyIngestionActivity(),
      snapshot([
        crawl("docs", "running"),
        crawl("blog", "indexed", { done: 2, total: 2 }),
        importRun(3, 1),
      ]),
      T0,
    );
    const tracked = trackedIngestionIds(state);
    expect(tracked.sources).toContain("docs");
    expect(tracked.sources).not.toContain("blog");
    expect(tracked.imports).toEqual(["imp-1"]);
  });

  it("keeps a dismissed run hidden while it carries on running", () => {
    const running = mergeIngestionSnapshot(
      emptyIngestionActivity(),
      snapshot([crawl("docs", "running")]),
      T0,
    );
    const hidden = dismissIngestionActivity(running, T0 + 1);
    expect(ingestionActivityCard(hidden)).toBeNull();

    // The same crawl's next poll, and the one that finishes it, stay hidden:
    // the user hid this crawl, not every crawl.
    const next = mergeIngestionSnapshot(
      hidden,
      snapshot([crawl("docs", "running", { done: 40, total: 291 })]),
      T0 + 3_000,
    );
    expect(ingestionActivityCard(next)).toBeNull();
    expect(ingestionActivityBusy(next)).toBe(true);

    const finished = mergeIngestionSnapshot(
      next,
      snapshot([crawl("docs", "indexed", { done: 291, total: 291 })]),
      T0 + 6_000,
    );
    expect(ingestionActivityCard(finished)).toBeNull();
  });

  it("re-opens for work the dismissal never saw", () => {
    const hidden = dismissIngestionActivity(
      mergeIngestionSnapshot(
        emptyIngestionActivity(),
        snapshot([crawl("docs", "running")]),
        T0,
      ),
      T0 + 1,
    );

    const fresh = mergeIngestionSnapshot(
      hidden,
      snapshot([crawl("docs", "running"), crawl("blog", "running")]),
      T0 + 2_000,
    );
    expect(ingestionActivityCard(fresh)?.title).toBe("Crawling 2 websites");
  });
});

describe("ordering", () => {
  it("puts failures first, then live work, then the queue", () => {
    const row = (id: string, status: IngestionActivityItem["status"]) => ({
      id,
      name: id,
      status,
    });
    const ordered = orderIngestionItems([
      row("d", "queued"),
      row("c", "indexed"),
      row("b", "running"),
      row("a", "failed"),
    ]);
    expect(ordered.map((item) => item.id)).toEqual(["a", "b", "c", "d"]);
  });
});

describe("the card", () => {
  it("counts the run, not the rows it shows", () => {
    const state = mergeIngestionSnapshot(
      emptyIngestionActivity(),
      snapshot([importRun(291, 261)]),
      T0,
    );
    const card = ingestionActivityCard(state)!;
    expect(card.title).toBe("Importing 291 items");
    expect(card.count).toBe("261/291");
    expect(card.items).toHaveLength(VISIBLE_ITEM_LIMIT);
    // 30 still pending, 4 of which are on the card.
    expect(card.overflow).toBe(291 - 261 - card.items.length);
    expect(card.busy).toBe(true);
  });

  it("counts a crawl in the pages it is bringing in, not in websites", () => {
    const state = mergeIngestionSnapshot(
      emptyIngestionActivity(),
      snapshot([crawl("docs", "running", { done: 128, total: 291 })]),
      T0,
    );
    const card = ingestionActivityCard(state)!;
    expect(card.title).toBe("Crawling docs.example");
    expect(card.count).toBe("128/291");
    // One row, and it is on the card: nothing is hidden behind a footer.
    expect(card.overflow).toBe(0);
  });

  it("shows no fraction for a crawl whose page total is not known yet", () => {
    const state = mergeIngestionSnapshot(
      emptyIngestionActivity(),
      snapshot([crawl("docs", "running")]),
      T0,
    );
    expect(ingestionActivityCard(state)?.count).toBeNull();
  });

  it("falls back to counting sources when pages and documents are both running", () => {
    const state = mergeIngestionSnapshot(
      emptyIngestionActivity(),
      snapshot([crawl("docs", "running", { done: 40, total: 291 }), importRun(4, 1)]),
      T0,
    );
    const card = ingestionActivityCard(state)!;
    // 5 rows (one website, four documents), one of them done.
    expect(card.title).toBe("Indexing 5 sources");
    expect(card.count).toBe("1/5");
  });

  it("names a single website and drops the count", () => {
    const state = mergeIngestionSnapshot(
      emptyIngestionActivity(),
      snapshot([crawl("docs", "running")]),
      T0,
    );
    const card = ingestionActivityCard(state)!;
    expect(card.title).toBe("Crawling docs.example");
    expect(card.count).toBeNull();
  });

  it("switches to the past tense once nothing is running, and says what was lost", () => {
    const state = mergeIngestionSnapshot(
      emptyIngestionActivity(),
      snapshot([importRun(10, 10, 2)]),
      T0,
    );
    const card = ingestionActivityCard(state)!;
    expect(ingestionActivityBusy(state)).toBe(false);
    expect(card.title).toBe("Imported 8 of 10 items");
    expect(card.failed).toBe(2);
    expect(card.overflow).toBe(0);
  });

  it("says nothing at all when there is nothing to follow", () => {
    expect(ingestionActivityCard(emptyIngestionActivity())).toBeNull();
  });
});
