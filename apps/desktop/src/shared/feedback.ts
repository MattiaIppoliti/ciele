// Which interface cue a change in the wizard or the stack deserves (#817).
//
// Pure, so the renderer's screens compute it from two snapshots and the rule
// is tested here rather than heard in a packaged app. Free of electron, node
// and React like everything else in shared/.

import type { StackHealth } from "./stack";
import type { StepStatus } from "../setup/types";

/** The subset of the console's interaction vocabulary the native screens use. */
export type NativeCue = "success" | "error" | "arrive";

/**
 * A step that just settled: `done` is the success cue, `failed` the error cue.
 * Steps that were already settled, or that moved between pending/running, are
 * silent. Called with the previous and next step statuses in step order.
 */
export function stepCues(
  before: readonly StepStatus[] | null,
  after: readonly StepStatus[],
): NativeCue[] {
  if (before === null) return [];
  const cues: NativeCue[] = [];
  after.forEach((status, index) => {
    const was = before[index];
    if (was === status) return;
    if (status === "done") cues.push("success");
    else if (status === "failed") cues.push("error");
  });
  return cues;
}

/** The stack coming up is an arrival; every other change is silent. */
export function stackCue(before: StackHealth | null, after: StackHealth): NativeCue | null {
  if (before === null) return null;
  if (before !== "running" && after === "running") return "arrive";
  return null;
}
