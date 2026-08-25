import type { RoutineCadence, TeammateRoutine } from "@agent-hub/core";
import { routineNextRun } from "@agent-hub/core";

/**
 * What the Routines panel says (#772).
 *
 * In a `.ts` module because this app's vitest ignores `.tsx`, and because the
 * schedule line is the one thing a person checks before trusting a routine to
 * run without them. "Every day at 08:00 UTC" has to be true.
 */

export const CADENCE_LABELS: Record<RoutineCadence, string> = {
  daily: "Every day",
  weekly: "Every Monday",
  monthly: "The 1st of each month",
};

/**
 * The schedule in words. UTC is stated rather than converted, because the
 * schedule really is in UTC (an Organization timezone does not exist yet) and
 * showing a local time we do not honour would be a lie a user only catches at
 * 09:00 in the summer.
 */
export function scheduleLine(
  routine: Pick<TeammateRoutine, "cadence" | "hour">
): string {
  const hour = `${String(routine.hour).padStart(2, "0")}:00 UTC`;
  return `${CADENCE_LABELS[routine.cadence]} at ${hour}`;
}

/**
 * The status line under it: what happened last, and what happens next.
 *
 * A disabled routine says so first, because "Last run: failed" beside a switch
 * that is off reads as a live problem when it is a paused one.
 */
export function statusLine(
  routine: Pick<
    TeammateRoutine,
    "cadence" | "hour" | "enabled" | "lastRunAt" | "lastStatus" | "lastDetail" | "createdAt"
  >,
  now: Date
): string {
  if (!routine.enabled) return "Paused";
  if (routine.lastStatus === "failed") {
    return routine.lastDetail
      ? `Last run failed: ${routine.lastDetail}`
      : "Last run failed";
  }
  const next = routineNextRun(routine, now);
  if (!routine.lastRunAt) {
    return next ? `First run ${formatWhen(next, now)}` : "Not scheduled";
  }
  return next
    ? `Ran ${formatWhen(new Date(routine.lastRunAt), now)}, next ${formatWhen(next, now)}`
    : "Not scheduled";
}

/**
 * A coarse relative time. Coarse on purpose: "in 3 hours" is what somebody
 * wants from a schedule, and a live-updating "in 2 hours 58 minutes" is noise
 * that also makes the component non-deterministic to render.
 */
export function formatWhen(moment: Date, now: Date): string {
  const deltaMs = moment.getTime() - now.getTime();
  const future = deltaMs > 0;
  const absMs = Math.abs(deltaMs);
  // Tested against the raw delta rather than against rounded hours: half an
  // hour rounds to one, and "in 1 hour" for 30 minutes is the wrong answer.
  if (absMs < 3_600_000) return future ? "shortly" : "just now";
  const hours = Math.round(absMs / 3_600_000);
  if (hours < 24) {
    const unit = hours === 1 ? "hour" : "hours";
    return future ? `in ${hours} ${unit}` : `${hours} ${unit} ago`;
  }
  const days = Math.round(hours / 24);
  const unit = days === 1 ? "day" : "days";
  return future ? `in ${days} ${unit}` : `${days} ${unit} ago`;
}

/** The empty state. Names the flagship template, because a blank box is a wall. */
export const ROUTINES_EMPTY_HINT =
  "No routines yet. A routine is a standing instruction this teammate carries out on its own, like \"every morning, triage yesterday's thumbs-down and file what is new\".";

/**
 * Why the panel is refusing to add another.
 *
 * Stated rather than a disabled button with no explanation: five is a real
 * limit and the way out (delete or pause one) is not obvious from a greyed
 * control.
 */
export function capReason(count: number, cap: number): string | null {
  return count >= cap
    ? `${cap} routines is the limit. Delete or pause one to add another.`
    : null;
}
