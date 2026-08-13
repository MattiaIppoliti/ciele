import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DueRecrawlClaim } from "@agent-hub/core";
import type { Db } from "@agent-hub/db";

const mocks = vi.hoisted(() => ({
  restartWebsiteCrawl: vi.fn(),
  finalizeWebsiteCrawl: vi.fn(),
  runDueGoalEvals: vi.fn(),
  runDueAnswerVerifications: vi.fn(),
  runTrustMaterialization: vi.fn(),
  runCompostPass: vi.fn(),
}));

vi.mock("./ingest", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./ingest")>();
  return {
    ...actual,
    restartWebsiteCrawl: mocks.restartWebsiteCrawl,
    finalizeWebsiteCrawl: mocks.finalizeWebsiteCrawl,
  };
});
vi.mock("./goal-runner", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./goal-runner")>()),
  runDueGoalEvals: mocks.runDueGoalEvals,
}));
vi.mock("./verifier", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./verifier")>()),
  runDueAnswerVerifications: mocks.runDueAnswerVerifications,
}));
vi.mock("./trust", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./trust")>()),
  runTrustMaterialization: mocks.runTrustMaterialization,
}));
vi.mock("./compost", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./compost")>()),
  runCompostPass: mocks.runCompostPass,
}));

import {
  CRAWL_FINALIZE_BATCH_SIZE,
  GOAL_EVAL_BATCH_SIZE,
  RECRAWL_SWEEP_BATCH_SIZE,
  finalizeDueCrawls,
  runDueAgenticOps,
  sweepDueRecrawls,
  sweepExpiredTraces,
} from "./scheduled";

/**
 * The policy of one scheduled tick: how much it claims, that a single failure
 * never takes the batch down, and what it reports. These assertions used to run
 * through apps/web's cron route handlers; they live here because the behavior
 * does, and a tick no longer needs a Request to be exercised.
 *
 * The crawl pipeline itself is faked — this is the orchestration's rules, not
 * the provider seam. `recrawl.scheduled.test.ts` drives the real lifecycle.
 */

const NO_JOBS = { claimed: 0, succeeded: 0, failed: 0, retried: 0 };

/** A Db stub with the claim methods a tick touches; everything else is absent. */
function stubDb(overrides: Partial<Db>): Db {
  return {
    claimDueRecrawlSources: vi.fn().mockResolvedValue([]),
    claimProcessingCrawlSources: vi.fn().mockResolvedValue([]),
    claimBackgroundJobs: vi.fn().mockResolvedValue([]),
    listDueEntitySyncConfigs: vi.fn().mockResolvedValue([]),
    ...overrides,
  } as unknown as Db;
}

const dueSource = (n: number) => ({
  sourceId: `source-${n}`,
  collectionId: `collection-${n}`,
  assistantId: `assistant-${n}`,
});

beforeEach(() => {
  mocks.restartWebsiteCrawl.mockReset();
  mocks.finalizeWebsiteCrawl.mockReset();
  // The start op reports whether a run actually began (#510).
  mocks.restartWebsiteCrawl.mockResolvedValue({ started: true });
  mocks.finalizeWebsiteCrawl.mockResolvedValue("processing");
});

describe("sweepDueRecrawls", () => {
  it("claims a bounded batch and starts each due Source through the manual pipeline", async () => {
    const batch = Array.from({ length: RECRAWL_SWEEP_BATCH_SIZE }, (_, i) => dueSource(i));
    const claim = vi.fn().mockResolvedValue(batch);
    const db = stubDb({ claimDueRecrawlSources: claim });

    const report = await sweepDueRecrawls({ db });

    expect(claim).toHaveBeenCalledWith(
      expect.objectContaining({ limit: RECRAWL_SWEEP_BATCH_SIZE })
    );
    expect(mocks.restartWebsiteCrawl).toHaveBeenCalledTimes(RECRAWL_SWEEP_BATCH_SIZE);
    expect(mocks.restartWebsiteCrawl).toHaveBeenCalledWith(
      expect.objectContaining({ sourceId: "source-0" })
    );
    expect(report).toMatchObject({
      recrawls: { swept: RECRAWL_SWEEP_BATCH_SIZE, launched: RECRAWL_SWEEP_BATCH_SIZE },
    });
  });

  it("does not double-crawl when the sweep runs twice in a window", async () => {
    // The claim flips a due Source to `processing`, so the same Source is not
    // returned again within the window — mirror that state transition here.
    const due = [dueSource(1)];
    const claimed = new Set<string>();
    const db = stubDb({
      claimDueRecrawlSources: vi.fn(async ({ limit }: DueRecrawlClaim) =>
        due
          .filter((row) => !claimed.has(row.sourceId))
          .slice(0, limit)
          .map((row) => {
            claimed.add(row.sourceId);
            return row;
          })
      ),
    });

    await sweepDueRecrawls({ db });
    const second = await sweepDueRecrawls({ db });

    expect(mocks.restartWebsiteCrawl).toHaveBeenCalledTimes(1);
    expect(second.recrawls.swept).toBe(0);
  });

  it("reports a re-crawl refused for budget as skipped, not as launched", async () => {
    // A crawl the scraping allowance refused (#510) is neither a run nor a
    // failure; a sweep that counted it as launched would claim work it never did.
    const db = stubDb({
      claimDueRecrawlSources: vi.fn().mockResolvedValue([
        { sourceId: "ok", collectionId: "c", assistantId: "a" },
        { sourceId: "capped", collectionId: "c", assistantId: "a" },
      ]),
    });
    mocks.restartWebsiteCrawl.mockImplementation(
      async ({ sourceId }: { sourceId: string }) =>
        sourceId === "capped"
          ? {
              started: false,
              outcome: "refused",
              reason: "Crawling is paused until the allowance resets.",
            }
          : { started: true }
    );

    const report = await sweepDueRecrawls({ db });

    expect(report).toMatchObject({
      recrawls: {
        swept: 2,
        launched: 1,
        results: expect.arrayContaining([
          expect.objectContaining({
            sourceId: "capped",
            status: "skipped",
            message: expect.stringMatching(/paused/i),
          }),
        ]),
      },
    });
  });

  it("reports a failed start without aborting the rest of the batch", async () => {
    const db = stubDb({
      claimDueRecrawlSources: vi.fn().mockResolvedValue([
        { sourceId: "ok", collectionId: "c", assistantId: "a" },
        { sourceId: "boom", collectionId: "c", assistantId: "a" },
      ]),
    });
    mocks.restartWebsiteCrawl.mockImplementation(
      async ({ sourceId }: { sourceId: string }) => {
        if (sourceId === "boom") throw new Error("Not found");
        return { started: true };
      }
    );

    const report = await sweepDueRecrawls({ db });

    expect(report).toMatchObject({
      recrawls: {
        swept: 2,
        launched: 1,
        results: expect.arrayContaining([
          expect.objectContaining({
            sourceId: "boom",
            status: "error",
            message: "Not found",
          }),
        ]),
      },
    });
  });

  it("honours an explicit batch limit", async () => {
    const claim = vi.fn().mockResolvedValue([]);
    await sweepDueRecrawls({ db: stubDb({ claimDueRecrawlSources: claim }) }, { limit: 2 });
    expect(claim).toHaveBeenCalledWith(expect.objectContaining({ limit: 2 }));
  });
});

describe("finalizeDueCrawls", () => {
  it("finalizes only one bounded batch, leaving later crawls for another tick", async () => {
    const batch = Array.from({ length: CRAWL_FINALIZE_BATCH_SIZE }, (_, i) => dueSource(i));
    const claim = vi.fn().mockResolvedValue(batch);
    const db = stubDb({ claimProcessingCrawlSources: claim });

    const report = await finalizeDueCrawls({ db });

    expect(claim).toHaveBeenCalledWith(
      expect.objectContaining({ limit: CRAWL_FINALIZE_BATCH_SIZE })
    );
    expect(mocks.finalizeWebsiteCrawl).toHaveBeenCalledTimes(CRAWL_FINALIZE_BATCH_SIZE);
    expect(report).toMatchObject({
      jobs: NO_JOBS,
      graphSync: NO_JOBS,
      proposals: NO_JOBS,
      memories: NO_JOBS,
      entitySyncs: { ...NO_JOBS, enqueued: 0 },
      crawls: { swept: CRAWL_FINALIZE_BATCH_SIZE, settled: 0 },
    });
  });

  it("leases the batch under one worker id and a stale-before window", async () => {
    const claim = vi.fn().mockResolvedValue([]);
    const now = new Date("2026-03-01T12:00:00.000Z");

    await finalizeDueCrawls({ db: stubDb({ claimProcessingCrawlSources: claim }) }, { now });

    const [args] = claim.mock.calls[0]!;
    expect(args.now).toBe(now.toISOString());
    // A stale lease is reclaimable: the window must open strictly before now.
    expect(new Date(args.staleBefore).getTime()).toBeLessThan(now.getTime());
    expect(args.workerId).toMatch(/^cron-finalize-crawls-/);
  });

  it("reports a finalize failure per Source and still settles the others", async () => {
    const db = stubDb({
      claimProcessingCrawlSources: vi.fn().mockResolvedValue([
        { sourceId: "ok", collectionId: "c", assistantId: "a" },
        { sourceId: "boom", collectionId: "c", assistantId: "a" },
      ]),
    });
    mocks.finalizeWebsiteCrawl.mockImplementation(
      async ({ sourceId }: { sourceId: string }) => {
        if (sourceId === "boom") throw new Error("run vanished");
        return "ready";
      }
    );

    const report = await finalizeDueCrawls({ db });

    expect(report.crawls).toMatchObject({
      swept: 2,
      // "ready" and "error" both count as settled; only "processing" does not.
      settled: 2,
      results: expect.arrayContaining([
        expect.objectContaining({ sourceId: "ok", status: "ready" }),
        expect.objectContaining({
          sourceId: "boom",
          status: "error",
          message: "run vanished",
        }),
      ]),
    });
  });
});

describe("sweepExpiredTraces", () => {
  it("computes each org's cutoff from its own window and reports totals", async () => {
    const now = new Date("2026-07-30T12:00:00.000Z");
    const clearExpiredTraces = vi
      .fn()
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(0);
    const db = stubDb({
      listTraceRetentionPolicies: async () => [
        { organizationId: "org-30", retentionDays: 30 },
        { organizationId: "org-7", retentionDays: 7 },
      ],
      clearExpiredTraces,
    });

    const report = await sweepExpiredTraces({ db }, { now });

    expect(clearExpiredTraces).toHaveBeenCalledWith(
      "org-30",
      "2026-06-30T12:00:00.000Z"
    );
    expect(clearExpiredTraces).toHaveBeenCalledWith(
      "org-7",
      "2026-07-23T12:00:00.000Z"
    );
    expect(report.traces).toMatchObject({
      organizations: 2,
      cleared: 3,
      results: expect.arrayContaining([
        { organizationId: "org-30", retentionDays: 30, cleared: 3 },
        { organizationId: "org-7", retentionDays: 7, cleared: 0 },
      ]),
    });
  });

  it("one org failing never aborts the rest of the tick", async () => {
    const db = stubDb({
      listTraceRetentionPolicies: async () => [
        { organizationId: "boom", retentionDays: 30 },
        { organizationId: "fine", retentionDays: 30 },
      ],
      clearExpiredTraces: vi
        .fn()
        .mockRejectedValueOnce(new Error("db offline"))
        .mockResolvedValueOnce(2),
    });

    const report = await sweepExpiredTraces({ db });

    expect(report.traces.cleared).toBe(2);
    expect(report.traces.results).toEqual(
      expect.arrayContaining([
        { organizationId: "boom", retentionDays: 30, error: "db offline" },
        { organizationId: "fine", retentionDays: 30, cleared: 2 },
      ])
    );
  });

  it("does nothing when no organization opted into retention", async () => {
    const clearExpiredTraces = vi.fn();
    const db = stubDb({
      listTraceRetentionPolicies: async () => [],
      clearExpiredTraces,
    });
    const report = await sweepExpiredTraces({ db });
    expect(clearExpiredTraces).not.toHaveBeenCalled();
    expect(report.traces).toEqual({ organizations: 0, cleared: 0, results: [] });
  });
});

describe("runDueAgenticOps", () => {
  beforeEach(() => {
    const order: string[] = [];
    mocks.runDueGoalEvals.mockImplementation(async () => {
      order.push("goals");
      return { processed: 2, failed: 1 };
    });
    mocks.runDueAnswerVerifications.mockImplementation(async () => {
      order.push("verification");
      return { graded: 3 };
    });
    mocks.runTrustMaterialization.mockImplementation(async () => {
      order.push("trust");
      return { materialized: 1 };
    });
    mocks.runCompostPass.mockImplementation(async () => {
      order.push("compost");
      return { proposals: 0 };
    });
    (mocks as unknown as { order: string[] }).order = order;
  });

  it("runs goals → verification → trust → compost, in that order", async () => {
    const db = stubDb({});
    const report = await runDueAgenticOps({ db });
    // Trust materializes AFTER verification (tonight's verdicts feed tonight's
    // tiers) and compost digests last — the sequencing is the drain's policy.
    expect((mocks as unknown as { order: string[] }).order).toEqual([
      "goals",
      "verification",
      "trust",
      "compost",
    ]);
    expect(report).toEqual({
      goals: { processed: 2, failed: 1 },
      verification: { graded: 3 },
      trust: { materialized: 1 },
      compost: { proposals: 0 },
    });
  });

  it("bounds the goal batch by default and honors an override", async () => {
    const db = stubDb({});
    await runDueAgenticOps({ db });
    expect(mocks.runDueGoalEvals).toHaveBeenCalledWith(
      { db },
      { limit: GOAL_EVAL_BATCH_SIZE }
    );
    await runDueAgenticOps({ db }, { goalLimit: 3 });
    expect(mocks.runDueGoalEvals).toHaveBeenLastCalledWith(
      { db },
      { limit: 3 }
    );
  });
});
