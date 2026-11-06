import { z } from "zod";
import type { Db } from "@agent-hub/db";
import type { HelpDeskOperator, OperatorStatus } from "@agent-hub/core";
import {
  DEFAULT_OPERATOR_CAPACITY,
  canOperateConversations,
  deskHasAvailableOperator,
  effectiveOperatorState,
  effectiveOperatorStatus,
  pickOperator,
  waitingQueue,
} from "@agent-hub/core";
import { OperationError, defineOperation, type OperationContext } from "./operation";

/**
 * Operators per Help Desk, their Available/Away status, and assignment
 * (#1084). The rule itself is `pickOperator` in core; this module gathers its
 * inputs from the Db and writes the result.
 */

/** How far back the least-recently-assigned tie-break looks. */
const ASSIGNMENT_HISTORY_MS = 30 * 24 * 60 * 60_000;

async function availableMembers(db: Db, organizationId: string, now = new Date()): Promise<Set<string>> {
  const [rows, members] = await Promise.all([db.table("operatorPresence").list({ organizationId }), db.listMembers(organizationId)]);
  const operators = new Set(members.filter(member => canOperateConversations(member.role)).map(member => member.userId));
  return new Set(rows.filter(row => operators.has(row.memberId) && effectiveOperatorStatus(row, now) === "available").map(row => row.memberId));
}

/**
 * Desks whose Live operator channel may be offered right now: at least one
 * of their operators is Available, so a Visitor is never put in a queue
 * nobody is watching. Fails closed: a read error offers no desk.
 */
export async function desksWithAvailableOperator(db: Db, organizationId: string): Promise<Set<string>> {
  try {
    const [operators, available] = await Promise.all([
      db.table("helpDeskOperators").list({ organizationId }),
      availableMembers(db, organizationId),
    ]);
    const byDesk = new Map<string, HelpDeskOperator[]>();
    for (const operator of operators) {
      byDesk.set(operator.helpDeskId, [...(byDesk.get(operator.helpDeskId) ?? []), operator]);
    }
    return new Set(
      [...byDesk].filter(([, rows]) => deskHasAvailableOperator(rows, available)).map(([deskId]) => deskId)
    );
  } catch {
    return new Set();
  }
}

/**
 * Assigns every unassigned waiting Conversation of the Organization that a
 * free operator can take, oldest wait first. Run when a wait starts, when an
 * operator releases a Conversation, and when an operator comes back
 * Available. Returns what it assigned, so a caller can tell the operator.
 */
export async function assignWaitingConversations(
  db: Db,
  organizationId: string,
  now: Date = new Date()
): Promise<Array<{ conversationId: string; memberId: string }>> {
  const [conversations, operators, available, history] = await Promise.all([
    db.listOperatorConversations(organizationId),
    db.table("helpDeskOperators").list({ organizationId }),
    availableMembers(db, organizationId, now),
    db.listOperatorAssignments(
      organizationId,
      new Date(now.getTime() - ASSIGNMENT_HISTORY_MS).toISOString()
    ),
  ]);
  // Load: what an operator holds, plus what is assigned to them and not yet
  // taken, so two waits in a row do not both land on the same person.
  const load = new Map<string, number>();
  for (const conversation of conversations) {
    const state = effectiveOperatorState(conversation.operator, now);
    const member =
      state === "held"
        ? conversation.operator?.memberId
        : state === "waiting"
          ? conversation.operator?.assignedMemberId
          : null;
    if (member) load.set(member, (load.get(member) ?? 0) + 1);
  }
  const lastAssignedAt = new Map<string, string>();
  for (const { memberId, assignedAt } of history) {
    const previous = lastAssignedAt.get(memberId);
    if (!previous || assignedAt > previous) lastAssignedAt.set(memberId, assignedAt);
  }

  const assigned: Array<{ conversationId: string; memberId: string }> = [];
  for (const entry of waitingQueue(conversations, now)) {
    const operator = entry.conversation.operator;
    if (!operator || operator.assignedMemberId) continue;
    const deskOperators = operators
      .filter((row) => row.helpDeskId === operator.waitingHelpDeskId)
      .map((row) => ({ memberId: row.memberId, capacity: row.capacity }));
    const memberId = pickOperator({ operators: deskOperators, available, load, lastAssignedAt });
    if (!memberId) continue;
    const at = now.toISOString();
    const done = await db.assignWaitingConversation({
      conversationId: entry.conversation.id,
      memberId,
      now: at,
    });
    if (!done) continue;
    load.set(memberId, (load.get(memberId) ?? 0) + 1);
    lastAssignedAt.set(memberId, at);
    assigned.push({ conversationId: entry.conversation.id, memberId });
  }
  return assigned;
}

async function requireDesk(ctx: OperationContext, helpDeskId: string) {
  const desk = await ctx.db.getHelpDesk(helpDeskId);
  if (!desk || desk.organizationId !== ctx.organizationId) {
    throw new OperationError("not_found", "Help desk not found");
  }
  return desk;
}

export const listHelpDeskOperatorsOp = defineOperation({
  name: "helpDesks.operators.list",
  capability: "helpDesks:view",
  effect: "read",
  input: z.object({ helpDeskId: z.string().min(1) }),
  entities: () => [],
  run: async (ctx, { helpDeskId }): Promise<HelpDeskOperator[]> => {
    await requireDesk(ctx, helpDeskId);
    return ctx.db.table("helpDeskOperators").list({ helpDeskId });
  },
});

export const setHelpDeskOperatorsOp = defineOperation({
  name: "helpDesks.operators.set",
  capability: "helpDesks:edit",
  effect: "write",
  input: z.object({
    helpDeskId: z.string().min(1),
    operators: z
      .array(
        z.object({
          memberId: z.string().min(1),
          capacity: z.number().int().min(1).max(50).default(DEFAULT_OPERATOR_CAPACITY),
        })
      )
      .max(200),
  }),
  entities: (input) => [{ kind: "helpDesk" as const, id: input.helpDeskId }],
  run: async (ctx, { helpDeskId, operators }): Promise<HelpDeskOperator[]> => {
    await requireDesk(ctx, helpDeskId);
    // Only a Member who may answer Visitors can staff a desk: a Viewer named
    // here could never go Available, so the desk would list nobody real.
    const members = new Set(
      (await ctx.db.listMembers(ctx.organizationId))
        .filter((member) => canOperateConversations(member.role))
        .map((member) => member.userId)
    );
    const unknown = operators.find((operator) => !members.has(operator.memberId));
    if (unknown) {
      throw new OperationError(
        "invalid_input",
        "Every operator must be a Member of the Organization who may answer Visitors"
      );
    }
    const table = ctx.db.table("helpDeskOperators");
    const current = await table.list({ helpDeskId });
    const wanted = new Map(operators.map((operator) => [operator.memberId, operator.capacity]));
    for (const row of current) {
      const capacity = wanted.get(row.memberId);
      if (capacity === undefined) await table.delete(row.id);
      else if (capacity !== row.capacity) await table.update(row.id, { capacity });
      wanted.delete(row.memberId);
    }
    for (const [memberId, capacity] of wanted) {
      await table.insert({ organizationId: ctx.organizationId, helpDeskId, memberId, capacity });
    }
    return table.list({ helpDeskId });
  },
});

export const getOperatorStatusOp = defineOperation({
  name: "operators.status.get",
  capability: "inbox:view",
  effect: "read",
  input: z.object({}),
  entities: () => [],
  run: async (ctx): Promise<{ status: OperatorStatus }> => {
    const [row] = await ctx.db.table("operatorPresence").list({
      organizationId: ctx.organizationId,
      memberId: ctx.userId,
    });
    return { status: effectiveOperatorStatus(row) };
  },
});

export const setOperatorStatusOp = defineOperation({
  name: "operators.status.set",
  capability: "inbox:operate",
  effect: "write",
  input: z.object({ status: z.enum(["available", "away"]), renewOnly: z.boolean().optional() }),
  entities: () => [{ kind: "inbox" as const }],
  run: async (ctx, { status, renewOnly }): Promise<{ status: OperatorStatus; assigned: number }> => {
    if (!ctx.userId) throw new OperationError("invalid_input", "Setting a status needs a signed-in Member");
    if (renewOnly) {
      const renewed = await ctx.db.renewOperatorPresence({ organizationId: ctx.organizationId, memberId: ctx.userId, now: new Date().toISOString() });
      const assigned = renewed ? await assignWaitingConversations(ctx.db, ctx.organizationId) : [];
      return { status: renewed ? "available" : "away", assigned: assigned.length };
    }
    const table = ctx.db.table("operatorPresence");
    const [row] = await table.list({ organizationId: ctx.organizationId, memberId: ctx.userId });
    if (row) await table.update(row.id, { status });
    else await table.insert({ organizationId: ctx.organizationId, memberId: ctx.userId, status });
    // Coming back Available frees a slot that a waiting Visitor may need.
    const assigned =
      status === "available" ? await assignWaitingConversations(ctx.db, ctx.organizationId) : [];
    return { status, assigned: assigned.length };
  },
});
