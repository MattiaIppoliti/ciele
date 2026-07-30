/**
 * The agent loop's iteration budget, and — the point of this module — the fact
 * that the MODEL IS TOLD ABOUT IT (#558).
 *
 * The loop has always been bounded: `stopWhen` cuts it off. But being cut off
 * is not the same as knowing the limit, and a model that does not know how many
 * turns it has left cannot plan. The reference platform states the budget in
 * every single tool result, escalating as it runs down, and its traces show the
 * model reacting to it — dropping a third search it would otherwise have run,
 * or deciding to ask one clarifying question instead of guessing.
 *
 * So the hard stop stays exactly where it was; this adds the telling.
 */

/** How many agent-loop iterations a single turn may spend. */
export const MAX_AGENT_ITERATIONS = 6;

export interface LoopBudget {
  readonly limit: number;
  /** Iterations consumed so far. */
  readonly iteration: number;
  /**
   * Consumes one iteration for the CURRENT step, and returns its number
   * (1-based). Idempotent within a step: a step that calls three tools in
   * parallel spends one iteration, not three.
   *
   * This is what the reference platform counts — its notes run 1, 2, 3… per
   * assistant turn, not per tool call — and it is load-bearing rather than
   * cosmetic. Its own prompt tells the model to fetch endpoint details **in
   * parallel** for every endpoint it expects to need, so charging per call would
   * spend the whole budget on discovery before anything was queried.
   */
  spend: () => number;
  /** Closes the current step, so the next one may spend again. */
  endStep: () => void;
  /**
   * The system note for the iteration just spent — appended to the tool result
   * the model is about to read.
   */
  note: () => string;
}

/**
 * The escalating note. Three forms, because "you have budget", "you have one
 * turn" and "this is your last turn" are three different instructions and
 * blurring them is what lets a model run out mid-thought:
 *
 *  - with room to spare: state where it is, and that the terminal tool is
 *    mandatory before any answer;
 *  - one iteration left: stop planning, finalize now;
 *  - final iteration: no more tools, no answer text yet — the next thing has to
 *    be the terminal tool, and there will not be another turn.
 */
export function iterationNote(iteration: number, limit: number): string {
  const remaining = limit - iteration;
  if (remaining <= 0) {
    return (
      `CRITICAL: this is iteration ${iteration}/${limit}, your final turn. ` +
      "You MUST call ReadyToAnswer now. Do not call any other tool and do not " +
      "write answer text yet — you will not get another turn."
    );
  }
  if (remaining === 1) {
    return (
      `You are at iteration ${iteration} of ${limit}. You have 1 iteration ` +
      "remaining. You MUST call ReadyToAnswer now, before writing any answer text."
    );
  }
  return (
    `You are now at iteration ${iteration} out of ${limit}. Plan your tool ` +
    "calls strategically and finalize within the iteration limit. IMPORTANT: " +
    "before any final answer to the user, you MUST call the 'ReadyToAnswer' " +
    "tool exactly once. This still applies if the answer is brief or already " +
    "obvious from what you have found."
  );
}

export function createLoopBudget(limit = MAX_AGENT_ITERATIONS): LoopBudget {
  let iteration = 0;
  // Whether the current step has already been charged. Parallel tool calls all
  // land inside one step, so only the first of them spends.
  let spentThisStep = false;
  return {
    limit,
    get iteration() {
      return iteration;
    },
    spend: () => {
      if (spentThisStep) return iteration;
      spentThisStep = true;
      return ++iteration;
    },
    endStep: () => {
      spentThisStep = false;
    },
    note: () => iterationNote(iteration, limit),
  };
}

/**
 * Attaches the budget note to a tool result. Object results carry it as a
 * `systemNote` field; anything else is boxed, because the model has to be able
 * to read the note without the tool having to cooperate in its own metering.
 *
 * Nothing is attached when the turn has no budget wired (pure tests, the
 * deterministic no-model path) — the note is guidance, never load-bearing.
 */
export function withBudgetNote(output: unknown, budget?: LoopBudget): unknown {
  if (!budget) return output;
  const systemNote = budget.note();
  if (output !== null && typeof output === "object" && !Array.isArray(output)) {
    return { ...(output as Record<string, unknown>), systemNote };
  }
  return { result: output, systemNote };
}
