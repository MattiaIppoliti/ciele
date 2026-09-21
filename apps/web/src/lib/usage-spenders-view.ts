import {
  rankSpenders,
  spenderDimensions,
  type SpenderTotal,
  type UsageSpenderDimension,
  type UsageSpenderRow,
} from "@agent-hub/core";

/**
 * "Where the credits went" (#848): the ledger's spender rows, pivoted per
 * dimension and labelled, ready for a renderer with no arithmetic of its own.
 *
 * The pivot itself is `rankSpenders` in the domain package; what lives here is
 * presentation policy, which dimensions are worth a section, how many rows to
 * show, and what to call a spender the organization has since deleted.
 *
 * Pure, and outside the page component, for the reason the summary fold beside
 * it gives: the app's vitest only picks up `.test.ts`.
 */

/** How many spenders a section lists before the rest fold into one row. */
export const SPENDERS_PER_SECTION = 5;

export const SPENDER_DIMENSION_LABELS: Record<UsageSpenderDimension, string> = {
  assistant: "Assistants",
  teammate: "Teammates",
  member: "Members",
  api_key: "API keys",
  routine: "Routines",
  flow: "Flows",
};

export interface SpenderEntryView {
  /** The spender's id, or null for the bucket this dimension cannot name. */
  id: string | null;
  label: string;
  credits: number;
  platformCredits: number;
  ownCredits: number;
  calls: number;
  /** Share of the section's credits, 0–1, for a bar. */
  fraction: number;
}

export interface SpenderSectionView {
  dimension: UsageSpenderDimension;
  title: string;
  credits: number;
  entries: SpenderEntryView[];
}

/** Display names for the ids the ledger records, per dimension. */
export type SpenderLabels = Partial<
  Record<UsageSpenderDimension, Record<string, string>>
>;

/**
 * What to call one spender. A ledger outlives what it names, on purpose (the
 * columns carry no foreign key), so an id with no current name is reported as
 * deleted rather than rendered raw or dropped: the credits were still spent.
 */
function labelFor(
  dimension: UsageSpenderDimension,
  id: string | null,
  labels: SpenderLabels
): string {
  if (id === null) return "Unattributed";
  const known = labels[dimension]?.[id];
  if (known) return known;
  return `Deleted ${SPENDER_DIMENSION_LABELS[dimension]
    .toLowerCase()
    .replace(/s$/, "")}`;
}

function toEntries(
  totals: SpenderTotal[],
  dimension: UsageSpenderDimension,
  labels: SpenderLabels
): SpenderEntryView[] {
  const sectionCredits = totals.reduce((sum, t) => sum + t.credits, 0);
  const shown = totals.slice(0, SPENDERS_PER_SECTION);
  const rest = totals.slice(SPENDERS_PER_SECTION);
  const entries = shown.map((total) => ({
    id: total.id,
    label: labelFor(dimension, total.id, labels),
    credits: total.credits,
    platformCredits: total.platformCredits,
    ownCredits: total.ownCredits,
    calls: total.calls,
    fraction: sectionCredits > 0 ? total.credits / sectionCredits : 0,
  }));
  if (rest.length === 0) return entries;
  // The tail is summed rather than truncated, so the section still adds up to
  // the window: a breakdown that silently drops spend is worse than none.
  const tail = rest.reduce(
    (at, total) => ({
      credits: at.credits + total.credits,
      platformCredits: at.platformCredits + total.platformCredits,
      ownCredits: at.ownCredits + total.ownCredits,
      calls: at.calls + total.calls,
    }),
    { credits: 0, platformCredits: 0, ownCredits: 0, calls: 0 }
  );
  return [
    ...entries,
    {
      id: null,
      label: `${rest.length} more`,
      ...tail,
      fraction: sectionCredits > 0 ? tail.credits / sectionCredits : 0,
    },
  ];
}

/**
 * One section per dimension that actually names somebody.
 *
 * A dimension whose every row is unattributed is omitted: an organization with
 * no Routines should not be shown a Routines section reading "Unattributed,
 * 100%". A dimension that names at least one spender keeps its unattributed
 * entry, because that is what makes the column add up.
 */
export function spenderBreakdownView(
  rows: readonly UsageSpenderRow[],
  labels: SpenderLabels = {}
): SpenderSectionView[] {
  const sections: SpenderSectionView[] = [];
  for (const dimension of spenderDimensions) {
    const totals = rankSpenders(rows, dimension);
    if (!totals.some((total) => total.id !== null)) continue;
    sections.push({
      dimension,
      title: SPENDER_DIMENSION_LABELS[dimension],
      credits: totals.reduce((sum, total) => sum + total.credits, 0),
      entries: toEntries(totals, dimension, labels),
    });
  }
  return sections;
}
