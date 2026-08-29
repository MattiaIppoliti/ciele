import type {
  ConversationMetadata,
  RoutineCadence,
  TeammateRoutine,
} from "./types";

/**
 * When a Routine is due (#772), as pure functions of the row plus the clock.
 *
 * The scheduling rule lives here rather than in SQL because it has to be the
 * same answer in both `Db` implementations and in a test with no database, and
 * because "did this already run today" is exactly the kind of rule that rots
 * when it is written twice. The seam over-fetches on the loosest window and
 * this decides; the claim is then a compare-and-set on `lastRunAt`.
 */

/**
 * How many a Teammate may have. Five is the spec's number (#767).
 *
 * Also written as a literal in `20260823170000_teammate_routine_cap.sql`, which
 * is the constraint behind the readable refusal. Two homes for one number
 * because SQL cannot import this one; change both.
 */
export const TEAMMATE_ROUTINE_CAP = 5;

export const ROUTINE_CADENCES: readonly RoutineCadence[] = [
  "daily",
  "weekly",
  "monthly",
];

/**
 * The loosest window any cadence can be due within, used by the cron's
 * over-fetch. 20 hours rather than 24: a tick that drifts late must not push
 * a daily routine into tomorrow, the same slack the standing-goal runner uses.
 */
export const ROUTINE_OVERFETCH_MS = 20 * 3_600_000;

/**
 * The most recent moment this routine was scheduled to run at or before `now`.
 *
 * This is the whole schedule in one function. A routine is due when its last
 * run predates its current slot, which makes "run once per window even with a
 * drifting tick" fall out rather than needing a separate guard: a tick at
 * 08:01 and another at 08:59 see the same slot, and the second finds the run
 * already stamped inside it.
 *
 * UTC throughout. An Organization timezone exists nowhere yet (it is an open
 * gap in the reference parity map), and picking the server's zone would make
 * the same routine fire at different local times on different deployments.
 */
export function routineSlotStart(
  routine: Pick<TeammateRoutine, "cadence" | "hour">,
  now: Date
): Date {
  const slot = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      routine.hour,
      0,
      0,
      0
    )
  );
  // Today's slot has not arrived yet: the current one is the previous period's.
  if (slot.getTime() > now.getTime()) slot.setUTCDate(slot.getUTCDate() - 1);

  if (routine.cadence === "daily") return slot;
  if (routine.cadence === "weekly") {
    // Monday-anchored. `getUTCDay()` is 0 for Sunday, so Sunday is 6 days in.
    const daysSinceMonday = (slot.getUTCDay() + 6) % 7;
    slot.setUTCDate(slot.getUTCDate() - daysSinceMonday);
    return slot;
  }
  // Monthly: the first of the month, at the preferred hour. If that moment is
  // still ahead of `now` (early on the 1st), the current slot is last month's.
  const monthly = new Date(
    Date.UTC(slot.getUTCFullYear(), slot.getUTCMonth(), 1, routine.hour, 0, 0, 0)
  );
  if (monthly.getTime() > now.getTime()) {
    monthly.setUTCMonth(monthly.getUTCMonth() - 1);
  }
  return monthly;
}

/**
 * Whether this routine should run now.
 *
 * A disabled routine is never due, and a routine that has never run is due as
 * soon as its first slot has passed rather than immediately on creation:
 * creating one at 17:00 with an 08:00 daily cadence should not fire a run in
 * the next minute, because nobody asked for one today.
 */
export function isRoutineDue(
  routine: Pick<TeammateRoutine, "cadence" | "hour" | "enabled" | "lastRunAt" | "createdAt">,
  now: Date
): boolean {
  if (!routine.enabled) return false;
  const slot = routineSlotStart(routine, now).getTime();
  if (!routine.lastRunAt) {
    // Never run: due only if the slot opened after it was created.
    return slot >= new Date(routine.createdAt).getTime();
  }
  return new Date(routine.lastRunAt).getTime() < slot;
}

/** When it will next run, for the surface that shows a schedule. */
export function routineNextRun(
  routine: Pick<TeammateRoutine, "cadence" | "hour" | "enabled" | "lastRunAt" | "createdAt">,
  now: Date
): Date | null {
  if (!routine.enabled) return null;
  if (isRoutineDue(routine, now)) return now;
  const slot = routineSlotStart(routine, now);
  const next = new Date(slot);
  if (routine.cadence === "daily") next.setUTCDate(next.getUTCDate() + 1);
  else if (routine.cadence === "weekly") next.setUTCDate(next.getUTCDate() + 7);
  else next.setUTCMonth(next.getUTCMonth() + 1);
  return next;
}

/**
 * What a Routine run's Conversation is marked with (#772, story 26).
 *
 * A run is an ordinary Teammate Conversation in every way the runtime cares
 * about, so what makes it a routine run is a fact about where it came from,
 * kept in metadata rather than in a column. The thread reads this to label it,
 * which matters: without the label a routine's output looks like something the
 * author said this morning.
 */
export function routineConversationMetadata(
  routine: Pick<TeammateRoutine, "id" | "instruction">
): Pick<ConversationMetadata, "routineId" | "routineName"> {
  return {
    routineId: routine.id,
    // The instruction is the name: routines have no title, and the first line
    // of what somebody asked for reads better than "Routine 3".
    routineName: routineTitle(routine.instruction),
  };
}

/** Whether this Conversation came from an unattended run rather than a person. */
export function isRoutineConversation(
  metadata: Pick<ConversationMetadata, "routineId"> | null | undefined
): boolean {
  return Boolean(metadata?.routineId);
}

/** A routine's one-line name: its first sentence, trimmed to fit a list row. */
export function routineTitle(instruction: string): string {
  const firstLine = instruction.trim().split("\n")[0]?.trim() ?? "";
  const sentence = firstLine.split(/(?<=[.!?])\s/)[0] ?? firstLine;
  const text = (sentence || firstLine).trim();
  return text.length > 80 ? `${text.slice(0, 77)}...` : text || "Routine";
}
