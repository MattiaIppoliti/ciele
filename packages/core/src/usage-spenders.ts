/**
 * Where the credits went (#848): the pivot from the ledger's spender grain onto
 * one ranked list.
 *
 * A usage row carries several identities at once (a Teammate turn names the
 * Teammate *and* the Member who asked), so "top spenders" is only a
 * well-defined question once a dimension is chosen. Grouping by one dimension
 * at a time is what keeps a column adding up to the window's total: every row
 * lands in exactly one bucket, and rows with no value for that dimension land
 * in the unattributed one rather than vanishing.
 *
 * Pure, so the Usage block is a renderer with no arithmetic of its own.
 */

import { creditsFor, type MeteredUnit } from "./pricing";
import type { UsageSpenderRow,
  UsageProvider,
} from "./types";

/** The identities a spender breakdown can be grouped by. */
export type UsageSpenderDimension =
  | "assistant"
  | "teammate"
  | "member"
  | "api_key"
  | "routine"
  | "flow";

/** Every dimension, in the order the Usage block offers them. */
export const spenderDimensions: readonly UsageSpenderDimension[] = [
  "assistant",
  "teammate",
  "member",
  "api_key",
  "routine",
  "flow",
];

/** One spender's consumption over the window, priced in credits. */
export interface SpenderTotal {
  dimension: UsageSpenderDimension;
  /** The spender's id, or null for the bucket of rows this dimension cannot name. */
  id: string | null;
  /** Total credits, platform-funded and the customer's own together. */
  credits: number;
  /** The half a plan meter counts. */
  platformCredits: number;
  /** Work on the customer's own credentials: attributed, never counted. */
  ownCredits: number;
  calls: number;
}

/** The row's value for one dimension, or null when it carries none. */
function idFor(
  row: UsageSpenderRow,
  dimension: UsageSpenderDimension
): string | null {
  switch (dimension) {
    case "assistant":
      return row.assistantId ?? null;
    case "teammate":
      return row.spenders.teammateId ?? null;
    case "member":
      return row.spenders.memberId ?? null;
    case "api_key":
      return row.spenders.apiKeyId ?? null;
    case "routine":
      return row.spenders.routineId ?? null;
    case "flow":
      return row.spenders.flowId ?? null;
  }
}

/**
 * A ledger row as priceable work. A crawl row has pages and no model; a model
 * row has tokens and no pages. The two are disjoint by construction, so the
 * `units` column decides which shape to price.
 */
function meteredUnitOf(row: UsageSpenderRow): MeteredUnit {
  return row.units > 0
    ? { kind: "crawl", crawler: row.provider, pages: row.units }
    : {
        kind: "model",
        provider: row.provider as UsageProvider,
        modelId: row.modelId,
        inputTokens: row.inputTokens,
        outputTokens: row.outputTokens,
      };
}

/**
 * Rank one window's usage by a single spender dimension, most expensive first.
 *
 * Rows the dimension cannot name are collected into one entry with a null id
 * rather than dropped, so the column still totals the window. That entry is
 * omitted only when there is nothing in it.
 */
export function rankSpenders(
  rows: readonly UsageSpenderRow[],
  dimension: UsageSpenderDimension
): SpenderTotal[] {
  const totals = new Map<string, SpenderTotal>();
  for (const row of rows) {
    const id = idFor(row, dimension);
    // A null id is a bucket of its own and must not collide with an entity
    // literally named "null"; the prefix keeps the two apart.
    const key = id === null ? "\0unattributed" : `id:${id}`;
    const at = totals.get(key) ?? {
      dimension,
      id,
      credits: 0,
      platformCredits: 0,
      ownCredits: 0,
      calls: 0,
    };
    const credits = creditsFor([meteredUnitOf(row)]);
    at.credits += credits;
    // Everything that is not platform-funded is the customer's own spend:
    // BYOK, a federated credential and a Member's personal subscription alike.
    if (row.credentialKind === "platform") at.platformCredits += credits;
    else at.ownCredits += credits;
    at.calls += row.calls;
    totals.set(key, at);
  }
  return [...totals.values()].sort((a, b) => {
    // The unattributed bucket sorts by cost like any other, so a large one is
    // visible rather than parked at the end where nobody reads it.
    if (b.credits !== a.credits) return b.credits - a.credits;
    return (a.id ?? "").localeCompare(b.id ?? "");
  });
}
