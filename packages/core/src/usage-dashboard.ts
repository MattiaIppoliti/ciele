/**
 * The Insights Dashboard read model: what the Organization's AI spends, how
 * fast and how reliably it answers, how often it is right and how often it
 * needs a human.
 *
 * Pure over `DashboardFacts`, so the page is a renderer with no arithmetic of
 * its own. The facts arrive at a fine grain and every filter here selects whole
 * rows, which is what keeps a total the sum of its parts whichever surface or
 * Assistant is picked.
 */

import { estimateCostEur } from "./pricing";
import type {
  AiUsageStage,
  DashboardFacts,
  DashboardSurface,
  DashboardTurnFact,
  DashboardUsageFact,
  RuntimeEventSurface,
  UsageProvider,
  UsageSurface,
} from "./types";

/**
 * Upper bounds of the latency histogram, in milliseconds. A turn lands in the
 * first bucket whose bound is above its duration; the last bucket is open.
 * `org_dashboard_turns` passes the same array to `width_bucket`, so the two
 * agree by construction rather than by a copy of the numbers kept in step.
 */
export const DASHBOARD_LATENCY_BOUNDS_MS: readonly number[] = [
  250, 500, 1000, 1500, 2000, 3000, 4000, 6000, 8000, 12000, 16000, 24000, 32000, 60000,
];

/** The histogram bucket a turn of `durationMs` belongs to. */
export function latencyBucketOf(durationMs: number): number {
  let bucket = 0;
  for (const bound of DASHBOARD_LATENCY_BOUNDS_MS) {
    if (durationMs >= bound) bucket += 1;
    else break;
  }
  return bucket;
}

/** Which Dashboard surface a ledger row's surface belongs to; null when unrecorded. */
function dashboardSurfaceOf(surface: UsageSurface | null): DashboardSurface | null {
  switch (surface) {
    case "widget":
    case "preview":
    case "http_flow":
      return "assistants";
    case "teammate":
    case "channel":
    case "routine":
      return "teammates";
    case "api":
    case "ingestion":
    case "scheduled":
      return "internal";
    default:
      return null;
  }
}

/** The same grouping for a runtime event, whose vocabulary has only three chat surfaces. */
function dashboardSurfaceOfTurn(surface: RuntimeEventSurface | null): DashboardSurface | null {
  if (surface === "widget" || surface === "preview") return "assistants";
  if (surface === "teammate") return "teammates";
  return null;
}

export interface UsageDashboardFilter {
  /** First UTC day, YYYY-MM-DD, inclusive. */
  from: string;
  /** Last UTC day, YYYY-MM-DD, inclusive. */
  to: string;
  /** Empty for every surface. */
  surface: DashboardSurface | "";
  /** Empty for every Assistant. Only meaningful beside `assistants` or no surface. */
  assistantId: string;
}

export interface DashboardDay {
  day: string;
  spendEur: number;
  /** Spend split by the surface that produced it, for the stacked daily bars. */
  spendBySurface: Record<DashboardSurface | "unattributed", number>;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  turns: number;
  failedTurns: number;
  latencyP50Ms: number | null;
  latencyP95Ms: number | null;
  passes: number;
  fails: number;
  conversations: number;
  escalated: number;
}

export interface DashboardModelRow {
  provider: string;
  modelId: string;
  spendEur: number;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  /** Share of the window's spend, 0..1. */
  share: number;
}

export interface DashboardStageRow {
  stage: AiUsageStage;
  spendEur: number;
  calls: number;
  tokens: number;
}

export interface DashboardSurfaceRow {
  surface: DashboardSurface | "unattributed";
  spendEur: number;
  calls: number;
  tokens: number;
}

export interface DashboardLatencyBucket {
  /** Inclusive lower bound, ms. */
  fromMs: number;
  /** Exclusive upper bound, ms; null on the open last bucket. */
  toMs: number | null;
  turns: number;
}

export interface DashboardFlowSeries {
  name: string;
  total: number;
  /** Turns per period, aligned with `periods`. */
  turns: number[];
  /** Rank among the top five in each period, 1 = most used; null when unused that period. */
  ranks: (number | null)[];
}

export interface UsageDashboard {
  days: string[];
  totals: {
    spendEur: number;
    calls: number;
    inputTokens: number;
    outputTokens: number;
    turns: number;
    succeededTurns: number;
    failedTurns: number;
    /** Succeeded / finished turns; null with no turns. */
    successRate: number | null;
    latencyP50Ms: number | null;
    latencyP95Ms: number | null;
    meanLatencyMs: number | null;
    toolCallsPerTurn: number | null;
    /** Spend over finished turns; null with no turns. */
    costPerTurnEur: number | null;
    passes: number;
    fails: number;
    /** Verifier passes / verdicts; null with no verdicts. */
    evalPassRate: number | null;
    conversations: number;
    escalated: number;
    /** Conversations nobody escalated / conversations; null with none. */
    autonomyRate: number | null;
  };
  daily: DashboardDay[];
  models: DashboardModelRow[];
  stages: DashboardStageRow[];
  /** Always across every surface, so the split stays visible while one is filtered. */
  surfaces: DashboardSurfaceRow[];
  latency: DashboardLatencyBucket[];
  errors: Array<{ errorClass: string; turns: number }>;
  flows: {
    /** First UTC day of each period. */
    periods: string[];
    granularity: "day" | "week";
    series: DashboardFlowSeries[];
  };
}

const DAY_MS = 86_400_000;

/** Every UTC day from `from` to `to`, inclusive. Empty when the range is inverted. */
export function daysBetween(from: string, to: string): string[] {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return [];
  const days: string[] = [];
  for (let at = start; at <= end; at += DAY_MS) days.push(new Date(at).toISOString().slice(0, 10));
  return days;
}

function costOf(row: DashboardUsageFact): number {
  // The ledger stores the provider as free text; an unknown one prices at the
  // chat fallback, which overstates rather than hides a cost.
  return estimateCostEur(row.provider as UsageProvider, row.modelId, row.inputTokens, row.outputTokens);
}

/**
 * The `q` quantile of a latency histogram, interpolated linearly inside the
 * bucket it falls in. The open last bucket reports its lower bound: the honest
 * reading of "somewhere past a minute".
 */
export function histogramQuantile(counts: readonly number[], q: number): number | null {
  const total = counts.reduce((sum, n) => sum + n, 0);
  if (total === 0) return null;
  const target = q * total;
  let before = 0;
  for (let i = 0; i < counts.length; i += 1) {
    const n = counts[i] ?? 0;
    if (n > 0 && before + n >= target) {
      const lower = i === 0 ? 0 : DASHBOARD_LATENCY_BOUNDS_MS[i - 1];
      const upper = DASHBOARD_LATENCY_BOUNDS_MS[i];
      if (upper === undefined) return lower;
      return Math.round(lower + ((upper - lower) * (target - before)) / n);
    }
    before += n;
  }
  return DASHBOARD_LATENCY_BOUNDS_MS[DASHBOARD_LATENCY_BOUNDS_MS.length - 1];
}

function emptyHistogram(): number[] {
  return Array.from({ length: DASHBOARD_LATENCY_BOUNDS_MS.length + 1 }, () => 0);
}

function ratio(part: number, whole: number): number | null {
  return whole > 0 ? part / whole : null;
}

/** Period start for a day: itself, or the Monday on or before it. */
function periodOf(day: string, granularity: "day" | "week"): string {
  if (granularity === "day") return day;
  const at = new Date(`${day}T00:00:00Z`);
  const back = (at.getUTCDay() + 6) % 7;
  return new Date(at.getTime() - back * DAY_MS).toISOString().slice(0, 10);
}

/**
 * The five most used Flows and their rank against each other in each period.
 * Ranking among the five, rather than among every Flow, keeps the chart about
 * the Flows it shows: a sixth Flow overtaking one of them would otherwise push
 * a line off the bottom for reasons the chart never draws.
 */
function rankFlows(turns: DashboardTurnFact[], days: string[]): UsageDashboard["flows"] {
  const granularity = days.length > 21 ? "week" : "day";
  const periods = [...new Set(days.map((day) => periodOf(day, granularity)))];
  const periodIndex = new Map(periods.map((period, i) => [period, i]));
  const byFlow = new Map<string, number[]>();
  for (const row of turns) {
    if (!row.flowName) continue;
    const index = periodIndex.get(periodOf(row.day, granularity));
    if (index === undefined) continue;
    let counts = byFlow.get(row.flowName);
    if (!counts) {
      counts = periods.map(() => 0);
      byFlow.set(row.flowName, counts);
    }
    counts[index] += row.turns;
  }
  const top = [...byFlow.entries()]
    .map(([name, counts]) => ({ name, counts, total: counts.reduce((a, b) => a + b, 0) }))
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name))
    .slice(0, 5);
  const ranks = top.map(() => periods.map((): number | null => null));
  periods.forEach((_, p) => {
    // Ties keep the overall order, so a flat week does not reshuffle the lines.
    const order = top
      .map((flow, i) => ({ i, turns: flow.counts[p] }))
      .filter((entry) => entry.turns > 0)
      .sort((a, b) => b.turns - a.turns || a.i - b.i);
    order.forEach((entry, rank) => {
      ranks[entry.i][p] = rank + 1;
    });
  });
  return {
    periods,
    granularity,
    series: top.map((flow, i) => ({
      name: flow.name,
      total: flow.total,
      turns: flow.counts,
      ranks: ranks[i],
    })),
  };
}

export function computeUsageDashboard(
  facts: DashboardFacts,
  filter: UsageDashboardFilter
): UsageDashboard {
  const days = daysBetween(filter.from, filter.to);
  const daySet = new Set(days);
  const inScope = (row: { day: string; assistantId: string | null }) =>
    daySet.has(row.day) && (!filter.assistantId || row.assistantId === filter.assistantId);
  /**
   * Whether a row survives the surface filter. A row with no surface only
   * counts when no surface is picked, since it cannot be placed in any one of them.
   */
  const onSurface = (surface: DashboardSurface | null) => !filter.surface || surface === filter.surface;
  const usage = facts.usage.filter((row) => inScope(row) && onSurface(dashboardSurfaceOf(row.surface)));
  const turns = facts.turns.filter((row) => inScope(row) && onSurface(dashboardSurfaceOfTurn(row.surface)));
  /**
   * Verdicts and Conversations are Assistant facts: the verifier grades Assistant
   * answers, and only an Assistant's Conversation can be escalated to a help desk.
   * Narrowing to Teammates or internal work therefore selects none of them, which
   * the page reads as "not measured here" rather than as zero.
   */
  const assistantFacts = !filter.surface || filter.surface === "assistants";
  const verdicts = assistantFacts ? facts.verdicts.filter(inScope) : [];
  const conversations = assistantFacts ? facts.conversations.filter(inScope) : [];

  const daily = new Map<string, DashboardDay>(
    days.map((day) => [
      day,
      {
        day,
        spendEur: 0,
        spendBySurface: { assistants: 0, teammates: 0, internal: 0, unattributed: 0 },
        calls: 0,
        inputTokens: 0,
        outputTokens: 0,
        turns: 0,
        failedTurns: 0,
        latencyP50Ms: null,
        latencyP95Ms: null,
        passes: 0,
        fails: 0,
        conversations: 0,
        escalated: 0,
      },
    ])
  );

  const models = new Map<string, DashboardModelRow>();
  const stages = new Map<AiUsageStage, DashboardStageRow>();
  let spendEur = 0;
  let calls = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  for (const row of usage) {
    const cost = costOf(row);
    spendEur += cost;
    calls += row.calls;
    inputTokens += row.inputTokens;
    outputTokens += row.outputTokens;
    const day = daily.get(row.day);
    if (day) {
      day.spendEur += cost;
      day.spendBySurface[dashboardSurfaceOf(row.surface) ?? "unattributed"] += cost;
      day.calls += row.calls;
      day.inputTokens += row.inputTokens;
      day.outputTokens += row.outputTokens;
    }
    const modelKey = `${row.provider}\u0000${row.modelId}`;
    const model = models.get(modelKey) ?? {
      provider: row.provider,
      modelId: row.modelId,
      spendEur: 0,
      calls: 0,
      inputTokens: 0,
      outputTokens: 0,
      share: 0,
    };
    model.spendEur += cost;
    model.calls += row.calls;
    model.inputTokens += row.inputTokens;
    model.outputTokens += row.outputTokens;
    models.set(modelKey, model);
    const stage = stages.get(row.stage) ?? { stage: row.stage, spendEur: 0, calls: 0, tokens: 0 };
    stage.spendEur += cost;
    stage.calls += row.calls;
    stage.tokens += row.inputTokens + row.outputTokens;
    stages.set(row.stage, stage);
  }

  // The surface split ignores the surface filter on purpose (the Assistant
  // filter still applies): it is the one card that answers "where did it go".
  const surfaces = new Map<DashboardSurfaceRow["surface"], DashboardSurfaceRow>();
  for (const row of facts.usage) {
    if (!inScope(row)) continue;
    const key = dashboardSurfaceOf(row.surface) ?? "unattributed";
    const entry = surfaces.get(key) ?? { surface: key, spendEur: 0, calls: 0, tokens: 0 };
    entry.spendEur += costOf(row);
    entry.calls += row.calls;
    entry.tokens += row.inputTokens + row.outputTokens;
    surfaces.set(key, entry);
  }

  const histogram = emptyHistogram();
  const dayHistograms = new Map<string, number[]>();
  const errors = new Map<string, number>();
  let succeededTurns = 0;
  let failedTurns = 0;
  let durationMs = 0;
  let toolCalls = 0;
  for (const row of turns) {
    const bucket = Math.min(Math.max(row.latencyBucket, 0), histogram.length - 1);
    histogram[bucket] += row.turns;
    let dayHistogram = dayHistograms.get(row.day);
    if (!dayHistogram) {
      dayHistogram = emptyHistogram();
      dayHistograms.set(row.day, dayHistogram);
    }
    dayHistogram[bucket] += row.turns;
    durationMs += row.durationMs;
    toolCalls += row.toolCalls;
    const day = daily.get(row.day);
    if (day) day.turns += row.turns;
    if (row.status === "failed") {
      failedTurns += row.turns;
      if (day) day.failedTurns += row.turns;
      const errorClass = row.errorClass || "unknown";
      errors.set(errorClass, (errors.get(errorClass) ?? 0) + row.turns);
    } else {
      succeededTurns += row.turns;
    }
  }
  for (const [day, counts] of dayHistograms) {
    const entry = daily.get(day);
    if (!entry) continue;
    entry.latencyP50Ms = histogramQuantile(counts, 0.5);
    entry.latencyP95Ms = histogramQuantile(counts, 0.95);
  }

  let passes = 0;
  let fails = 0;
  for (const row of verdicts) {
    const day = daily.get(row.day);
    if (row.verdict === "pass") {
      passes += row.count;
      if (day) day.passes += row.count;
    } else {
      fails += row.count;
      if (day) day.fails += row.count;
    }
  }

  let conversationCount = 0;
  let escalated = 0;
  for (const row of conversations) {
    conversationCount += row.conversations;
    const day = daily.get(row.day);
    if (day) day.conversations += row.conversations;
    if (row.escalated) {
      escalated += row.conversations;
      if (day) day.escalated += row.conversations;
    }
  }

  const finished = succeededTurns + failedTurns;
  return {
    days,
    totals: {
      spendEur,
      calls,
      inputTokens,
      outputTokens,
      turns: finished,
      succeededTurns,
      failedTurns,
      successRate: ratio(succeededTurns, finished),
      latencyP50Ms: histogramQuantile(histogram, 0.5),
      latencyP95Ms: histogramQuantile(histogram, 0.95),
      meanLatencyMs: finished > 0 ? Math.round(durationMs / finished) : null,
      toolCallsPerTurn: ratio(toolCalls, finished),
      costPerTurnEur: ratio(spendEur, finished),
      passes,
      fails,
      evalPassRate: ratio(passes, passes + fails),
      conversations: conversationCount,
      escalated,
      autonomyRate: ratio(conversationCount - escalated, conversationCount),
    },
    daily: [...daily.values()],
    models: [...models.values()]
      .map((model) => ({ ...model, share: spendEur > 0 ? model.spendEur / spendEur : 0 }))
      .sort((a, b) => b.spendEur - a.spendEur || b.calls - a.calls),
    stages: [...stages.values()].sort((a, b) => b.spendEur - a.spendEur || b.calls - a.calls),
    surfaces: (["assistants", "teammates", "internal", "unattributed"] as const)
      .map((surface) => surfaces.get(surface) ?? { surface, spendEur: 0, calls: 0, tokens: 0 })
      .filter((row) => row.surface !== "unattributed" || row.calls > 0),
    latency: histogram.map((turnCount, i) => ({
      fromMs: i === 0 ? 0 : DASHBOARD_LATENCY_BOUNDS_MS[i - 1],
      toMs: DASHBOARD_LATENCY_BOUNDS_MS[i] ?? null,
      turns: turnCount,
    })),
    errors: [...errors.entries()]
      .map(([errorClass, turnCount]) => ({ errorClass, turns: turnCount }))
      .sort((a, b) => b.turns - a.turns || a.errorClass.localeCompare(b.errorClass)),
    flows: rankFlows(turns, days),
  };
}
