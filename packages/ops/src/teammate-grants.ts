import { z } from "zod";
import type {
  TeammateCapabilityCeiling,
  TeammateGrant,
  TeammateGrantDomain,
} from "@agent-hub/core";
import {
  TEAMMATE_CAPABILITY_CEILINGS,
  TEAMMATE_GRANT_DOMAINS,
} from "@agent-hub/core";
import { defineOperation, type OperationContext } from "./operation";
import { requireReadableTeammate } from "./teammate-access";

/**
 * Granting an AI Teammate its capabilities (#770).
 *
 * Two operations, and the asymmetry between them is the point. **Reading** is a
 * Member right over the roster they already have: what the org's Teammates may
 * do is something the colleagues working with them should be able to check, and
 * hiding it would only mean finding out by watching one act. It stops at
 * visibility, though, because a private Teammate is private from the roster
 * outward and answering for one would disclose it. **Writing** is
 * `manageMembers`, a rung above
 * the Editor who may rename a Teammate and pick its Knowledge Scope, because
 * handing an agent the ability to move the board or write knowledge is the same
 * kind of decision as handing a person a Role.
 *
 * The write is a whole-set replace rather than add/remove calls. Grants are a
 * checkbox list in the UI and a set in the model, and a set is not something to
 * mutate one element at a time across two round-trips that can half-fail.
 */

const domainSchema = z.enum(
  TEAMMATE_GRANT_DOMAINS as unknown as [TeammateGrantDomain, ...TeammateGrantDomain[]]
);
const ceilingSchema = z.enum(
  TEAMMATE_CAPABILITY_CEILINGS as unknown as [
    TeammateCapabilityCeiling,
    ...TeammateCapabilityCeiling[],
  ]
);

/** The whole governance state of one Teammate, as one screen reads it. */
export interface TeammateGovernance {
  teammateId: string;
  domains: TeammateGrantDomain[];
  ceiling: TeammateCapabilityCeiling;
  approvalBypass: boolean;
}

/** This Teammate's grant rows. Guarded through the Teammate, not the row. */
export async function readTeammateGrants(
  ctx: OperationContext,
  teammateId: string
): Promise<TeammateGrant[]> {
  return ctx.db.table("teammateGrants").list({ teammateId });
}

export const listTeammateGrantsOp = defineOperation({
  name: "teammates.grants.list",
  capability: "member",
  input: z.object({ id: z.string().min(1) }),
  entities: () => [],
  run: async (ctx, { id }): Promise<TeammateGovernance> => {
    const teammate = await requireReadableTeammate(ctx, id);
    const grants = await readTeammateGrants(ctx, id);
    return {
      teammateId: teammate.id,
      domains: grants.map((grant) => grant.domain),
      ceiling: teammate.capabilityCeiling,
      approvalBypass: teammate.approvalBypass,
    };
  },
});

export const setTeammateGrantsOp = defineOperation({
  name: "teammates.grants.set",
  // Admin, deliberately not the Editor capability the rest of the Teammate
  // takes. Renaming a colleague's agent and arming it are different acts.
  capability: "manageMembers",
  input: z.object({
    id: z.string().min(1),
    domains: z.array(domainSchema).max(TEAMMATE_GRANT_DOMAINS.length),
    ceiling: ceilingSchema.optional(),
    approvalBypass: z.boolean().optional(),
  }),
  entities: ({ id }) => [
    { kind: "teammate" as const, id },
    { kind: "teammateList" as const },
  ],
  run: async (ctx, input): Promise<TeammateGovernance> => {
    const teammate = await requireReadableTeammate(ctx, input.id);
    const wanted = new Set(input.domains);
    const held = await readTeammateGrants(ctx, input.id);
    const heldDomains = new Set(held.map((grant) => grant.domain));

    // Revoke first. If the two halves cannot both land, the state to be caught
    // in is the one holding fewer capabilities, not more.
    await Promise.all(
      held
        .filter((grant) => !wanted.has(grant.domain))
        .map((grant) => ctx.db.table("teammateGrants").delete(grant.id))
    );
    await Promise.all(
      [...wanted]
        .filter((domain) => !heldDomains.has(domain))
        .map((domain) =>
          ctx.db.table("teammateGrants").insert({
            organizationId: ctx.organizationId,
            teammateId: input.id,
            domain,
            grantedBy: ctx.userId || null,
          })
        )
    );

    const ceiling = input.ceiling ?? teammate.capabilityCeiling;
    const approvalBypass = input.approvalBypass ?? teammate.approvalBypass;
    if (
      ceiling !== teammate.capabilityCeiling ||
      approvalBypass !== teammate.approvalBypass
    ) {
      await ctx.db
        .table("teammates")
        .update(input.id, { capabilityCeiling: ceiling, approvalBypass });
    }
    return {
      teammateId: input.id,
      domains: TEAMMATE_GRANT_DOMAINS.filter((domain) => wanted.has(domain)),
      ceiling,
      approvalBypass,
    };
  },
});
