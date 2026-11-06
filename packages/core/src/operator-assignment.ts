/**
 * Which operator a waiting Conversation goes to (#1084): the small version of
 * presence-and-capacity routing. One presence flag, one capacity number,
 * least-loaded first, ties to whoever was assigned least recently.
 *
 * Pure over (operators, statuses, capacities, loads, last-assigned times), so
 * the rule is tested on its own and the callers only gather the inputs.
 */

/** Most Conversations an operator holds at once unless the desk says otherwise. */
export const DEFAULT_OPERATOR_CAPACITY = 3;

export type OperatorStatus = "available" | "away";

export interface DeskOperator {
  memberId: string;
  capacity: number;
}

export interface OperatorAssignmentInput {
  /** The desk's operators. */
  operators: readonly DeskOperator[];
  /** Members whose status is Available. Anyone absent is Away. */
  available: ReadonlySet<string>;
  /** Conversations each operator holds or has been assigned and not yet taken. */
  load: ReadonlyMap<string, number>;
  /** When each operator was last assigned a Conversation (ISO). Never = absent. */
  lastAssignedAt: ReadonlyMap<string, string>;
}

/**
 * The operator to assign, or null when nobody is free: every operator is
 * Away or at capacity, and the Conversation waits unassigned in the queue.
 */
export function pickOperator(input: OperatorAssignmentInput): string | null {
  const free = input.operators.filter(
    (operator) =>
      input.available.has(operator.memberId) &&
      (input.load.get(operator.memberId) ?? 0) < operator.capacity
  );
  if (free.length === 0) return null;
  const lastAssigned = (memberId: string) => {
    const at = input.lastAssignedAt.get(memberId);
    return at ? Date.parse(at) : Number.NEGATIVE_INFINITY;
  };
  const [first] = [...free].sort(
    (a, b) =>
      (input.load.get(a.memberId) ?? 0) - (input.load.get(b.memberId) ?? 0) ||
      lastAssigned(a.memberId) - lastAssigned(b.memberId) ||
      a.memberId.localeCompare(b.memberId)
  );
  return first!.memberId;
}

/** Whether a Live operator channel may be offered: somebody on the desk is Available. */
export function deskHasAvailableOperator(
  operators: readonly DeskOperator[],
  available: ReadonlySet<string>
): boolean {
  return operators.some((operator) => available.has(operator.memberId));
}

/** A closed console or an expired session stops renewing this lease. */
export const OPERATOR_PRESENCE_LEASE_MS = 2 * 60_000;
export function effectiveOperatorStatus(row: { status: OperatorStatus; updatedAt: string } | undefined, now = new Date()): OperatorStatus {
  return row?.status === "available" && Date.parse(row.updatedAt) > now.getTime() - OPERATOR_PRESENCE_LEASE_MS ? "available" : "away";
}
