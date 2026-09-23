import { describe, expect, it } from "vitest";
import { memoriesEmptyState } from "./memory-empty-state";

const record = (
  status: "pending" | "done" | "skipped_no_provider" | "failed",
  lastError: string | null = null
) => ({ status, lastError });

describe("memoriesEmptyState", () => {
  it("names the missing Provider Connection rather than looking broken", () => {
    expect(
      memoriesEmptyState({ extraction: record("skipped_no_provider") })
    ).toEqual({ kind: "no_provider" });
  });

  it("carries the failure's reason, which the Alert repeats", () => {
    expect(
      memoriesEmptyState({ extraction: record("failed", "upstream is down") })
    ).toEqual({ kind: "failed", lastError: "upstream is down" });
  });

  it("says extraction is under way while a job is queued", () => {
    expect(memoriesEmptyState({ extraction: record("pending") })).toEqual({
      kind: "extracting",
      remaining: 1,
    });
    // The record is written when a job finishes, so a freshly queued page has
    // no record at all: the ledger is what says it is under way, and how many
    // of the Source's Documents are still waiting with it.
    expect(
      memoriesEmptyState({
        extraction: null,
        queued: { thisPage: true, source: 12 },
      })
    ).toEqual({ kind: "extracting", remaining: 12 });
    // A queued job outranks the last outcome: the page is about to be re-read.
    expect(
      memoriesEmptyState({
        extraction: record("failed", "upstream is down"),
        queued: { thisPage: true, source: 3 },
      })
    ).toEqual({ kind: "extracting", remaining: 3 });
    // Other pages of the Source queued, this one not: nothing to wait for here.
    expect(
      memoriesEmptyState({
        extraction: null,
        queued: { thisPage: false, source: 3 },
      })
    ).toEqual({ kind: "not_extracted", nextCrawlAt: null });
  });

  it("offers the next crawl when nothing has tried yet", () => {
    expect(
      memoriesEmptyState({ extraction: null, nextCrawlAt: "2026-09-27T00:00:00.000Z" })
    ).toEqual({ kind: "not_extracted", nextCrawlAt: "2026-09-27T00:00:00.000Z" });
    // A Source with no cadence has no date to promise.
    expect(memoriesEmptyState({ extraction: null })).toEqual({
      kind: "not_extracted",
      nextCrawlAt: null,
    });
  });

  it("treats a finished extraction that found nothing the same way", () => {
    // `[]` is a correct answer for an index or a login page, and the reader
    // does not need that difference explained to them.
    expect(memoriesEmptyState({ extraction: record("done") })).toEqual({
      kind: "not_extracted",
      nextCrawlAt: null,
    });
  });
});
