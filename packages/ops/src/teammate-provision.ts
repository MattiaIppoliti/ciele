import { z } from "zod";
import type { Teammate, TeammateRoutine } from "@agent-hub/core";
import {
  ROUTINE_CADENCES,
  TEAMMATE_GRANT_DOMAINS,
  roleAllowsCapability,
} from "@agent-hub/core";
import type { TeammateGrantDomain } from "@agent-hub/core";
import { defineOperation } from "./operation";
import { createRoutineOp } from "./routines";
import { createTeammateOp, teammateInputSchema } from "./teammates";
import {
  setTeammateGrantsOp,
  type TeammateGovernance,
} from "./teammate-grants";

/**
 * Stand up a working AI Teammate in one call.
 *
 * The parts already existed and each is correct on its own; what they were not
 * is *one task*. Creating a Teammate makes a colleague that can read its
 * Knowledge Scope and answer questions and nothing else, because grants are
 * absence-is-refusal by design. Arming it is a second call on a different path
 * with a different capability, and giving it unattended work is a third. An
 * agent asked to "set up a triage colleague" had to rediscover that sequence
 * every session, and would usually stop after the first step holding something
 * that looked finished and was inert.
 *
 * This is the SDK move, not a new capability, and keeping that true takes one
 * explicit line. Capabilities are checked by the *surface*, before `run`, so a
 * composite that calls an inner operation's `run` bypasses that operation's
 * gate. Granting is a rung above creating on purpose, so the grant step
 * re-checks `manageMembers` here, against the same ladder the surface uses. A
 * first draft of this file did not, and an Editor could arm a Teammate through
 * it; `teammate-provision.test.ts` is what caught that and what keeps it
 * caught.
 *
 * **Not a transaction.** Nothing rolls back across these tables, so the order
 * is the guarantee instead, and it is chosen so that every partial outcome is
 * safe: create, then grant, then schedule. A failure after the create leaves a
 * Teammate that answers and cannot act. A failure after the grant leaves one
 * that acts only when a Member asks. The outcome this order cannot produce is
 * the dangerous one, a Teammate running unattended before its grants landed.
 * `partial` names how far it got, so the caller reads a field instead of
 * diffing what it asked for against what came back.
 */

const cadenceSchema = z.enum(
  ROUTINE_CADENCES as unknown as [
    (typeof ROUTINE_CADENCES)[number],
    ...(typeof ROUTINE_CADENCES)[number][],
  ]
);

const domainSchema = z.enum(
  TEAMMATE_GRANT_DOMAINS as unknown as [
    TeammateGrantDomain,
    ...TeammateGrantDomain[],
  ]
);

export interface ProvisionedTeammate {
  teammate: Teammate;
  /** Null when the caller asked for no grants, or when granting was refused. */
  governance: TeammateGovernance | null;
  routines: TeammateRoutine[];
  /**
   * The first step that did not run. `null` means everything asked for
   * happened. A refusal is reported, not thrown: the Teammate exists either
   * way, and throwing would leave the caller with a created row and an error.
   */
  partial: "grants" | "routines" | null;
  /** Why, when `partial` is set. */
  reason: string | null;
}

export const provisionTeammateOp = defineOperation({
  name: "teammates.provision",
  /**
   * `edit`, which is what creating takes. Granting re-checks `manageMembers`
   * inside its own operation, so declaring the higher capability here would
   * refuse an Editor the create-plus-routines call they are entitled to make.
   */
  capability: "edit",
  input: teammateInputSchema.extend({
    grants: z
      .array(domainSchema)
      .max(TEAMMATE_GRANT_DOMAINS.length)
      .optional()
      .describe("Domains to grant. Needs an admin-tier caller; omit for none."),
    ceiling: z.enum(["member", "edit"]).optional(),
    approvalBypass: z.boolean().optional(),
    routines: z
      .array(
        z.object({
          instruction: z.string().min(1).max(2000),
          cadence: cadenceSchema,
          hour: z.number().int().min(0).max(23).optional(),
        })
      )
      .max(5)
      .optional(),
  }),
  entities: () => [{ kind: "teammateList" as const }],
  run: async (ctx, input): Promise<ProvisionedTeammate> => {
    const { grants, ceiling, approvalBypass, routines, ...persona } = input;

    const teammate = await createTeammateOp.run(ctx, persona);
    const result: ProvisionedTeammate = {
      teammate,
      governance: null,
      routines: [],
      partial: null,
      reason: null,
    };

    if (grants?.length) {
      // The capability check that the surface would have done, done here.
      // Surfaces check `operation.capability` before calling `run`, so calling
      // an inner operation's `run` directly skips its gate: without this line a
      // composite declaring `edit` would let an Editor arm a Teammate, which is
      // precisely the decision `setTeammateGrantsOp` puts a rung above them.
      // A Teammate acting through this path is refused outright: arming another
      // agent is not something any ceiling buys.
      if (ctx.teammate || !roleAllowsCapability(ctx.role, setTeammateGrantsOp.capability)) {
        result.partial = "grants";
        result.reason = `Granting domains needs the ${setTeammateGrantsOp.capability} capability; the teammate was created without grants.`;
        return result;
      }
      try {
        result.governance = await setTeammateGrantsOp.run(ctx, {
          id: teammate.id,
          domains: grants,
          ceiling,
          approvalBypass,
        });
      } catch (error) {
        // Almost always the capability: an Editor may create a colleague and
        // may not arm one. Saying so beats a 403 that loses the Teammate id.
        result.partial = "grants";
        result.reason =
          error instanceof Error ? error.message : "Could not grant domains";
        return result;
      }
    }

    for (const routine of routines ?? []) {
      try {
        result.routines.push(
          await createRoutineOp.run(ctx, {
            teammateId: teammate.id,
            instruction: routine.instruction,
            cadence: routine.cadence,
            hour: routine.hour ?? 8,
          })
        );
      } catch (error) {
        result.partial = "routines";
        result.reason =
          error instanceof Error ? error.message : "Could not add a routine";
        return result;
      }
    }

    return result;
  },
});
