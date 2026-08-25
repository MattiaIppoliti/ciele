import { z } from "zod";
import type { TeammateRoutine, TeammateRoutinePatch } from "@agent-hub/core";
import { ROUTINE_CADENCES, TEAMMATE_ROUTINE_CAP } from "@agent-hub/core";
import { OperationError, defineOperation, type OperationContext } from "./operation";
import {
  requireEditableTeammate,
  requireReadableTeammate,
} from "./teammate-access";

/**
 * Routine CRUD (#772).
 *
 * Governance is the Teammate's, not a new one: owner, named editors and the
 * organization's admins, the same `canEditTeammate` rule the persona takes.
 * A routine is a standing instruction *for* the Teammate, so "who may change
 * what it does when nobody is watching" should not be a different question
 * from "who may change what it is".
 *
 * The cap is five per Teammate, checked here so the refusal is a sentence a
 * person can act on, and enforced by a trigger underneath so it is also true:
 * counting and then inserting leaves a gap two concurrent creates both pass.
 */

const cadenceSchema = z.enum(
  ROUTINE_CADENCES as unknown as [
    (typeof ROUTINE_CADENCES)[number],
    ...(typeof ROUTINE_CADENCES)[number][],
  ]
);
const instructionSchema = z.string().min(1).max(2000);
const hourSchema = z.number().int().min(0).max(23);

export const routinePatchSchema = z
  .object({
    instruction: instructionSchema,
    cadence: cadenceSchema,
    hour: hourSchema,
    enabled: z.boolean(),
  })
  .partial() satisfies z.ZodType<TeammateRoutinePatch, TeammateRoutinePatch>;

async function requireRoutine(
  ctx: OperationContext,
  id: string
): Promise<TeammateRoutine> {
  const routine = await ctx.db.table("teammateRoutines").get(id);
  if (!routine || routine.organizationId !== ctx.organizationId) {
    throw new OperationError("not_found", "Routine not found");
  }
  // Reached through its Teammate, so a routine can never be edited by someone
  // who could not edit the Teammate it belongs to.
  await requireEditableTeammate(ctx, routine.teammateId);
  return routine;
}

export const listRoutinesOp = defineOperation({
  name: "teammates.routines.list",
  capability: "member",
  input: z.object({ teammateId: z.string().min(1) }),
  entities: () => [],
  run: async (ctx, { teammateId }): Promise<TeammateRoutine[]> => {
    // Reading is a Member right: unattended work an agent does in your
    // workspace is not a secret from you. Visibility still applies.
    await requireReadableTeammate(ctx, teammateId);
    return ctx.db.table("teammateRoutines").list({ teammateId });
  },
});

export const createRoutineOp = defineOperation({
  name: "teammates.routines.create",
  capability: "edit",
  input: z.object({
    teammateId: z.string().min(1),
    instruction: instructionSchema,
    cadence: cadenceSchema,
    hour: hourSchema.default(8),
  }),
  entities: ({ teammateId }) => [{ kind: "teammate" as const, id: teammateId }],
  run: async (ctx, input): Promise<TeammateRoutine> => {
    await requireEditableTeammate(ctx, input.teammateId);
    const existing = await ctx.db
      .table("teammateRoutines")
      .list({ teammateId: input.teammateId });
    if (existing.length >= TEAMMATE_ROUTINE_CAP) {
      throw new OperationError(
        "conflict",
        `A teammate can have ${TEAMMATE_ROUTINE_CAP} routines. Delete or disable one first.`
      );
    }
    return ctx.db.table("teammateRoutines").insert({
      organizationId: ctx.organizationId,
      teammateId: input.teammateId,
      instruction: input.instruction,
      cadence: input.cadence,
      hour: input.hour,
      createdBy: ctx.userId || null,
    });
  },
});

export const updateRoutineOp = defineOperation({
  name: "teammates.routines.update",
  capability: "edit",
  input: z.object({ id: z.string().min(1), patch: routinePatchSchema }),
  entities: () => [{ kind: "teammateList" as const }],
  run: async (ctx, { id, patch }): Promise<TeammateRoutine> => {
    await requireRoutine(ctx, id);
    return ctx.db.table("teammateRoutines").update(id, patch);
  },
});

export const deleteRoutineOp = defineOperation({
  name: "teammates.routines.delete",
  capability: "edit",
  input: z.object({ id: z.string().min(1) }),
  entities: () => [{ kind: "teammateList" as const }],
  run: async (ctx, { id }): Promise<void> => {
    const routine = await requireRoutine(ctx, id);
    await ctx.db.table("teammateRoutines").delete(routine.id);
  },
});
