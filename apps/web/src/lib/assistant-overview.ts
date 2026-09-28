import type { Flow, Source, UsageDashboard } from "@agent-hub/core";

/**
 * The Assistant Overview's lists, as pure functions of what the page reads, so
 * the ordering the `.tsx` draws is tested here. The Activity rows are
 * `activityStats` in `lib/insights/dashboard-stats.ts`, beside the dashboards'.
 */

/**
 * The Sources most recently added across every Collection the Assistant reads.
 * A Source linked through two Collections is one Source, so it is listed once.
 */
export function recentSources(perCollection: readonly Source[][], limit: number): Source[] {
  const byId = new Map<string, Source>();
  for (const sources of perCollection) for (const source of sources) byId.set(source.id, source);
  return [...byId.values()]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.name.localeCompare(b.name))
    .slice(0, limit);
}

/**
 * Flows in the order the router tries them, the Default behavior last, because
 * that is the order that decides which one answers.
 */
export function flowsInRoutingOrder(flows: readonly Flow[]): Flow[] {
  return [...flows].sort(
    (a, b) => Number(a.isDefault) - Number(b.isDefault) || a.position - b.position || a.name.localeCompare(b.name)
  );
}

type Totals = UsageDashboard["totals"];

export interface QualityRow {
  key: "success" | "accuracy" | "autonomy";
  label: string;
  /** 0..1, or null when the week gave it nothing to measure. */
  rate: number | null;
  /** The same rate over the week before; null when that week had none. */
  previousRate: number | null;
  good: number;
  bad: number;
  goodLabel: string;
  badLabel: string;
  /** Why there is no rate, said on the row and in its tooltip. */
  empty: string;
}

/**
 * The Quality card's rows with what their tooltips break down: the counts
 * behind each share, and the same share the week before.
 */
export function qualityRows(totals: Totals, previous: Totals | null): QualityRow[] {
  return [
    {
      key: "success",
      label: "Success rate",
      rate: totals.successRate,
      previousRate: previous?.successRate ?? null,
      good: totals.succeededTurns,
      bad: totals.failedTurns,
      goodLabel: "succeeded",
      badLabel: "failed",
      empty: "No turns",
    },
    {
      key: "accuracy",
      label: "Answer accuracy",
      rate: totals.evalPassRate,
      previousRate: previous?.evalPassRate ?? null,
      good: totals.passes,
      bad: totals.fails,
      goodLabel: "passed the verifier",
      badLabel: "failed it",
      empty: "Not graded yet",
    },
    {
      key: "autonomy",
      label: "Autonomy",
      rate: totals.autonomyRate,
      previousRate: previous?.autonomyRate ?? null,
      good: totals.conversations - totals.escalated,
      bad: totals.escalated,
      goodLabel: "resolved by AI",
      badLabel: "escalated to a help desk",
      empty: "No conversations",
    },
  ];
}

/**
 * A rate's change in percentage points, "↑ 1.2 pts". Points rather than a
 * relative change: a share moving from 50% to 55% is "↑ 5 pts", where "↑ 10%"
 * would read as if it had moved twice as far.
 */
export function pointsDelta(rate: number | null, previousRate: number | null): string | null {
  if (rate === null || previousRate === null) return null;
  const points = (rate - previousRate) * 100;
  if (Math.abs(points) < 0.05) return "No change";
  return `${points > 0 ? "\u2191" : "\u2193"} ${Math.abs(points).toFixed(1)} pts`;
}
