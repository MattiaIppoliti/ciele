import { describe, expect, it } from "vitest";
import type { KnowledgeSearchResult } from "@agent-hub/db";
import {
  MAX_SEARCH_PASSES,
  runSearchPass,
  searchBudgetExhausted,
  type SearchPassRuntime,
} from "./search-pass";
import type { RuntimeEvent } from "../types";

/**
 * The search-pass primitive — the ONE writer of the per-turn search-pass
 * ledger (#204). Both the deterministic seed loop and the model's
 * searchKnowledge tool delegate here, so the lifecycle (tool-start/tool-end
 * pairing, coverage verdict, ledger append with scope, Sources collection,
 * budget refusal) is asserted once, for both callers.
 */

function makeResult(overrides: Partial<KnowledgeSearchResult> = {}): KnowledgeSearchResult {
  return {
    conceptId: "k1",
    conceptTitle: "Tuition fees",
    conceptPath: "fees.md",
    collectionId: "col1",
    collectionName: "General",
    sourceName: "Website",
    resourceUrl: null,
    content: "Fees are …",
    similarity: 0.9,
    ...overrides,
  };
}

function makeRuntime(
  searcher: SearchPassRuntime["searchKnowledge"],
  overrides: Partial<SearchPassRuntime> = {}
) {
  const events: RuntimeEvent[] = [];
  const ctx: SearchPassRuntime = {
    searchKnowledge: searcher,
    passes: [],
    usedSources: [],
    emit: (e) => events.push(e),
    ...overrides,
  };
  return { ctx, events };
}

type ToolStart = Extract<RuntimeEvent, { type: "tool-start" }>;
type ToolEnd = Extract<RuntimeEvent, { type: "tool-end" }>;

describe("runSearchPass — the one ledger writer", () => {
  it("emits a paired tool-start/tool-end lifecycle and records the pass with its scope", async () => {
    const hit = makeResult();
    const { ctx, events } = makeRuntime(async () => [hit]);

    const outcome = await runSearchPass("tuition fees", "collection", ctx);

    expect(outcome).toEqual({ kind: "searched", results: [hit] });
    // Ledger: one record carrying query, scope, results, and a verdict.
    expect(ctx.passes).toHaveLength(1);
    expect(ctx.passes[0]).toMatchObject({
      query: "tuition fees",
      scope: "collection",
      results: [hit],
      verdict: "sufficient",
    });
    // Sources collected for the reply's Sources part.
    expect(ctx.usedSources).toEqual([hit]);
    // Lifecycle: start and end, paired by callId.
    expect(events).toHaveLength(2);
    const [start, end] = events as [ToolStart, ToolEnd];
    expect(start).toMatchObject({
      type: "tool-start",
      tool: "searchKnowledge",
      label: "Searching knowledge for “tuition fees”",
      input: { query: "tuition fees", scope: "collection" },
    });
    expect(end).toMatchObject({
      type: "tool-end",
      tool: "searchKnowledge",
      ok: true,
      summary: "Found 1 relevant concept",
    });
    expect(end.callId).toBe(start.callId);
    expect(end.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("records an assistant-wide pass with its widened scope", async () => {
    const { ctx } = makeRuntime(async () => [makeResult()]);
    await runSearchPass("fees", "assistant", ctx);
    expect(ctx.passes[0]?.scope).toBe("assistant");
  });

  it("passes the scope through to the searcher", async () => {
    const seen: Array<{ scope?: string }> = [];
    const { ctx } = makeRuntime(async (_q, opts) => {
      seen.push(opts ?? {});
      return [];
    });
    await runSearchPass("fees", "assistant", ctx);
    expect(seen).toEqual([{ scope: "assistant" }]);
  });

  it("honors a caller-provided callId (the model tool's toolCallId)", async () => {
    const { ctx, events } = makeRuntime(async () => []);
    await runSearchPass("fees", "collection", ctx, { callId: "model-call-7" });
    expect((events[0] as ToolStart).callId).toBe("model-call-7");
    expect((events[1] as ToolEnd).callId).toBe("model-call-7");
  });

  it("an empty pass is recorded (verdict empty-conflicting) and ends ok — not a tool error", async () => {
    const { ctx, events } = makeRuntime(async () => []);
    const outcome = await runSearchPass("nothing here", "collection", ctx);
    expect(outcome).toEqual({ kind: "searched", results: [] });
    expect(ctx.passes[0]).toMatchObject({
      query: "nothing here",
      verdict: "empty-conflicting",
    });
    expect(ctx.usedSources).toEqual([]);
    expect(events[1]).toMatchObject({
      type: "tool-end",
      ok: true,
      summary: "No matching knowledge found",
    });
  });

  it("refuses once the budget is spent: no search, no ledger append, lifecycle still paired", async () => {
    let searches = 0;
    const { ctx, events } = makeRuntime(
      async () => {
        searches += 1;
        return [];
      },
      { budget: 2 }
    );
    await runSearchPass("one", "collection", ctx);
    await runSearchPass("two", "collection", ctx);
    const outcome = await runSearchPass("three", "collection", ctx);

    expect(outcome).toEqual({ kind: "budget-exhausted" });
    expect(searches).toBe(2);
    expect(ctx.passes).toHaveLength(2);
    // The refused call still renders in the Thinking panel: start + end.
    expect(events).toHaveLength(6);
    const [start, end] = events.slice(4) as [ToolStart, ToolEnd];
    expect(start.type).toBe("tool-start");
    expect(end).toMatchObject({ type: "tool-end", ok: true });
    expect(end.callId).toBe(start.callId);
  });

  it("defaults the budget to MAX_SEARCH_PASSES", async () => {
    const { ctx } = makeRuntime(async () => []);
    for (let i = 0; i < MAX_SEARCH_PASSES; i++) {
      await runSearchPass(`q${i}`, "collection", ctx);
    }
    const outcome = await runSearchPass("over", "collection", ctx);
    expect(outcome).toEqual({ kind: "budget-exhausted" });
    expect(ctx.passes).toHaveLength(MAX_SEARCH_PASSES);
  });

  it("swallow mode (seed loop): a throwing searcher is recorded as an empty pass, end ok:false", async () => {
    const { ctx, events } = makeRuntime(async () => {
      throw new Error("index offline");
    });
    const outcome = await runSearchPass("fees", "collection", ctx, {
      onError: "record-empty",
    });
    expect(outcome).toEqual({ kind: "searched", results: [] });
    // The failed pass still counts against the budget and feeds the gates.
    expect(ctx.passes[0]).toMatchObject({
      query: "fees",
      scope: "collection",
      results: [],
      verdict: "empty-conflicting",
    });
    // Visitors never see searcher internals — the generic no-results summary.
    expect(events[1]).toMatchObject({
      type: "tool-end",
      ok: false,
      summary: "No matching knowledge found",
    });
  });

  it("report mode (model tool): a throwing searcher fails the pass, records nothing", async () => {
    const { ctx, events } = makeRuntime(async () => {
      throw new Error("index offline");
    });
    const outcome = await runSearchPass("fees", "collection", ctx, {
      onError: "report",
    });
    expect(outcome).toEqual({ kind: "failed", message: "index offline" });
    // No ledger append: a failed model search does not consume budget.
    expect(ctx.passes).toHaveLength(0);
    expect(events[1]).toMatchObject({
      type: "tool-end",
      ok: false,
      summary: "index offline",
    });
  });
});

describe("searchBudgetExhausted — the one budget gate", () => {
  it("is spent exactly at the budget", () => {
    const pass = { query: "q", results: [], verdict: "empty-conflicting" as const };
    expect(searchBudgetExhausted([], 2)).toBe(false);
    expect(searchBudgetExhausted([pass], 2)).toBe(false);
    expect(searchBudgetExhausted([pass, pass], 2)).toBe(true);
  });

  it("defaults to MAX_SEARCH_PASSES", () => {
    const pass = { query: "q", results: [], verdict: "empty-conflicting" as const };
    expect(searchBudgetExhausted(Array(MAX_SEARCH_PASSES - 1).fill(pass))).toBe(false);
    expect(searchBudgetExhausted(Array(MAX_SEARCH_PASSES).fill(pass))).toBe(true);
  });
});
