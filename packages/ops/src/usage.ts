import { z } from "zod";
import {
  rankSpenders,
  spenderDimensions,
  type SpenderTotal,
  type UsageSpenderDimension,
} from "@agent-hub/core";
import { defineOperation, OperationError } from "./operation";

/**
 * Usage, read-only (#853).
 *
 * Two reads, the ones the console renders: the plan's meters, and who spent the
 * window's credits. Nothing here mutates, and nothing here is a purchase: a
 * purchase belongs to a surface where a person confirms an amount, the same
 * reason posting a channel message has no machine route.
 *
 * Both are `manageMembers`, the capability Usage already requires in the
 * console. A key's Role is the permission boundary, so a Viewer key gets the
 * same 403 a Viewer session does rather than a quieter empty answer.
 */

const windowSchema = z
  .object({
    /** ISO instant, inclusive. Defaults to 30 days before `to`. */
    from: z.string().datetime().optional(),
    /** ISO instant, exclusive. Defaults to now. */
    to: z.string().datetime().optional(),
  })
  .default({});

const DEFAULT_WINDOW_DAYS = 30;
/** A year, past which a caller should be exporting rather than paging a read. */
const MAX_WINDOW_DAYS = 366;

/** Resolve the optional bounds into a validated half-open window. */
export function resolveUsageWindow(
  input: { from?: string; to?: string },
  now: Date = new Date()
): { from: string; to: string } {
  const to = input.to ? new Date(input.to) : now;
  const from = input.from
    ? new Date(input.from)
    : new Date(to.getTime() - DEFAULT_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    throw new OperationError("invalid_input", "from and to must be ISO instants");
  }
  if (from >= to) {
    throw new OperationError("invalid_input", "from must be before to");
  }
  const days = (to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000);
  if (days > MAX_WINDOW_DAYS) {
    throw new OperationError(
      "invalid_input",
      `A window is at most ${MAX_WINDOW_DAYS} days; export the ledger for anything longer.`
    );
  }
  return { from: from.toISOString(), to: to.toISOString() };
}

/**
 * The plan's meters as the console shows them: cap, credits used and the exact
 * window, per resource. An uncapped deployment, which is every self-hosted one,
 * answers that it has no limits rather than returning zeroed meters, so a
 * consumer can tell "nothing is capped" from "nothing has been used".
 */
export const readUsageMetersOp = defineOperation({
  name: "usage.meters.read",
  capability: "manageMembers",
  input: z.object({}).default({}),
  entities: () => [],
  run: async (ctx) => {
    const limits = await ctx.ports?.readUsageLimits?.(ctx.organizationId);
    if (!limits) return { metered: false as const, plan: null, meters: [] };
    return {
      metered: true as const,
      plan: limits.plan,
      topupCredits: limits.topupCredits ?? null,
      meters: limits.meters,
    };
  },
});

export interface UsageSpendersResult {
  from: string;
  to: string;
  dimensions: {
    dimension: UsageSpenderDimension;
    spenders: SpenderTotal[];
  }[];
}

/**
 * Who spent the window's credits, grouped per dimension.
 *
 * The response keeps the dimensions apart rather than flattening them, because
 * a Teammate turn names both the Teammate and the Member who asked: the same
 * credit legitimately appears under two dimensions, and a flat list would invite
 * a consumer to add them up.
 */
export const readUsageSpendersOp = defineOperation({
  name: "usage.spenders.read",
  capability: "manageMembers",
  input: windowSchema,
  entities: () => [],
  run: async (ctx, input): Promise<UsageSpendersResult> => {
    const window = resolveUsageWindow(input);
    const rows = await ctx.db.getOrgUsageSpenders(
      ctx.organizationId,
      window.from,
      window.to
    );
    return {
      ...window,
      dimensions: spenderDimensions
        .map((dimension) => ({
          dimension,
          spenders: rankSpenders(rows, dimension),
        }))
        // A dimension that names nobody is omitted: an organization with no
        // Routines should not be handed a Routines bucket of one unattributed
        // row, which says nothing and reads as a bug.
        .filter((entry) => entry.spenders.some((s) => s.id !== null)),
    };
  },
});
