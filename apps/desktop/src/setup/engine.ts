// The setup engine: run steps in order, and let none of them be believed
// until it has proved itself.
//
// The rule the whole wizard rests on is `execute` then `verify`, and the next
// step does not start until verify says ok. "It ran without an error" and "it
// worked" are different claims, and a green check that means only the first
// one is worse than no check at all.
//
// Nothing here knows about Electron, React, Docker or the filesystem. It is a
// list of steps, a bag of state, and a subscription.

import type { SetupConfig, SetupPorts } from "./ports";
import type {
  SetupBag,
  SetupSnapshot,
  SetupStep,
  StepStatus,
  StepView,
} from "./types";

interface StepState {
  status: StepStatus;
  error: string | null;
  detail: string | null;
  help: { label: string; url: string } | null;
  guide: string[];
  logs: string[];
  input: Record<string, string>;
  /**
   * The user has said yes to this optional step. Required steps are accepted
   * by definition, choosing the local path is the consent for those.
   */
  accepted: boolean;
}

export interface SetupEngine {
  snapshot(): SetupSnapshot;
  subscribe(listener: (snapshot: SetupSnapshot) => void): () => void;
  /** Run forward from the first unfinished step until one fails or all pass. */
  run(): Promise<SetupSnapshot>;
  /** Clear the failure and run again from the same step. */
  retry(): Promise<SetupSnapshot>;
  /** Mark the current step skipped, optional steps only, and carry on. */
  skip(): Promise<SetupSnapshot>;
  /**
   * Put an already-settled optional step back on the table, so the user can
   * change their mind about a choice they already made.
   *
   * Optional steps only, and it clears nothing but that step: the ones after
   * it keep their results, so reconsidering the demo content does not undo the
   * model settings you went on to enter.
   */
  revisit(stepId: string): SetupSnapshot;
  setInput(stepId: string, values: Record<string, string>): SetupSnapshot;
  /** Back to a clean first run. */
  reset(): SetupSnapshot;
  /** What the steps have accumulated. The host reads it after completion. */
  bag(): Readonly<SetupBag>;
}

export interface CreateSetupEngineOptions {
  steps: readonly SetupStep[];
  ports: SetupPorts;
  config: SetupConfig;
}

export function createSetupEngine({
  steps,
  ports,
  config,
}: CreateSetupEngineOptions): SetupEngine {
  const listeners = new Set<(snapshot: SetupSnapshot) => void>();
  let states: StepState[] = steps.map(fresh);
  let bag: SetupBag = {};
  let running = false;

  function fresh(): StepState {
    return {
      status: "pending",
      error: null,
      detail: null,
      help: null,
      guide: [],
      logs: [],
      input: {},
      accepted: false,
    };
  }

  /**
   * An optional step the user has not yet said yes to. The run stops in front
   * of it rather than through it: "optional" that happens to you anyway is
   * not optional, and loading demo content into somebody's install because
   * they did not interrupt in time is exactly the wrong default.
   */
  function awaitingDecision(index: number): boolean {
    const step = steps[index];
    const state = states[index];
    if (!step || !state) return false;
    return step.optional === true && !state.accepted && state.status === "pending";
  }

  /** The first step that has neither passed nor been skipped. */
  function currentIndex(): number {
    const index = states.findIndex((s) => s.status !== "done" && s.status !== "skipped");
    return index === -1 ? steps.length - 1 : index;
  }

  function view(step: SetupStep, state: StepState): StepView {
    return {
      id: step.id,
      title: step.title,
      description: step.description,
      optional: step.optional === true,
      fields: step.fields ?? [],
      status: state.status,
      error: state.error,
      detail: state.detail,
      help: state.help,
      guide: [...state.guide],
      logs: [...state.logs],
    };
  }

  function snapshot(): SetupSnapshot {
    const index = currentIndex();
    return {
      steps: steps.map((step, i) => view(step, states[i]!)),
      currentIndex: index,
      complete: states.every((s) => s.status === "done" || s.status === "skipped"),
      running,
      awaitingDecision: !running && awaitingDecision(index),
    };
  }

  function emit(): SetupSnapshot {
    const next = snapshot();
    for (const listener of listeners) listener(next);
    return next;
  }

  async function runStep(index: number): Promise<boolean> {
    const step = steps[index]!;
    const state = states[index]!;
    // A retry starts from a clean slate for this step: stale logs from the
    // attempt that failed would read as if they belonged to this one.
    state.status = "running";
    state.error = null;
    state.detail = null;
    state.help = null;
    state.guide = [];
    state.logs = [];
    emit();

    const context = {
      ports,
      config,
      input: state.input,
      bag,
      log: (line: string) => {
        state.logs.push(line);
        emit();
      },
    };

    try {
      await step.execute(context);
    } catch (cause) {
      state.status = "failed";
      state.error = messageOf(cause);
      emit();
      return false;
    }

    let result;
    try {
      result = await step.verify(context);
    } catch (cause) {
      state.status = "failed";
      state.error = messageOf(cause);
      emit();
      return false;
    }

    state.detail = result.detail ?? null;
    state.help = result.help ?? null;
    state.guide = result.guide ?? [];
    if (!result.ok) {
      state.status = "failed";
      // A verify that fails without saying why is a dead end for the user, so
      // there is always *something* to read.
      state.error = result.detail ?? `${step.title} could not be verified.`;
      emit();
      return false;
    }
    state.status = "done";
    emit();
    return true;
  }

  /**
   * Run forward from where we are.
   *
   * Calling this IS the user pressing Continue, so the step we start on is
   * accepted by that act. The run then stops at the next optional step the
   * user has not spoken about; that is the wizard's rhythm: the required
   * chain runs unattended, and each choice gets asked.
   */
  async function runFrom(): Promise<SetupSnapshot> {
    if (running) return snapshot();
    running = true;
    states[currentIndex()]!.accepted = true;
    emit();
    try {
      // Recomputed each iteration rather than a for-loop over an index: a
      // step may have been skipped, and `currentIndex` is the one definition
      // of where we are.
      for (;;) {
        const index = currentIndex();
        const state = states[index]!;
        if (state.status === "done" || state.status === "skipped") break;
        if (awaitingDecision(index)) break;
        const ok = await runStep(index);
        if (!ok) break;
        if (index === steps.length - 1) break;
      }
    } finally {
      running = false;
    }
    return emit();
  }

  return {
    snapshot,
    bag: () => ({ ...bag }),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    run: runFrom,
    retry() {
      const state = states[currentIndex()]!;
      if (state.status === "failed") state.status = "pending";
      return runFrom();
    },
    async skip() {
      const index = currentIndex();
      const step = steps[index]!;
      if (step.optional !== true) {
        throw new Error(`"${step.title}" is required and cannot be skipped.`);
      }
      states[index]!.status = "skipped";
      states[index]!.error = null;
      emit();
      return runFrom();
    },
    revisit(stepId) {
      const index = steps.findIndex((step) => step.id === stepId);
      if (index === -1) throw new Error(`No such step: ${stepId}`);
      const step = steps[index]!;
      if (step.optional !== true) {
        // A required step already ran and its result is what everything after
        // it stands on. Offering to un-run it would promise something this
        // engine cannot honestly deliver.
        throw new Error(`"${step.title}" is required and cannot be revisited.`);
      }
      states[index] = { ...fresh(), input: states[index]!.input };
      return emit();
    },

    setInput(stepId, values) {
      const index = steps.findIndex((step) => step.id === stepId);
      if (index === -1) throw new Error(`No such step: ${stepId}`);
      states[index]!.input = { ...states[index]!.input, ...values };
      return emit();
    },
    reset() {
      states = steps.map(fresh);
      bag = {};
      return emit();
    },
  };
}

function messageOf(cause: unknown): string {
  if (cause instanceof Error && cause.message) return cause.message;
  return typeof cause === "string" && cause ? cause : "Something went wrong.";
}
