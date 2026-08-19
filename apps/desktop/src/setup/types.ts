// What a step is, and what the renderer sees of one.

import type { SetupConfig, SetupPorts } from "./ports";

export type StepStatus = "pending" | "running" | "done" | "failed" | "skipped";

/** A value the user supplies to a step, a provider key, a model name. */
export interface StepField {
  id: string;
  label: string;
  hint?: string;
  placeholder?: string;
  /** Rendered masked. Never logged, never sent anywhere but the env file. */
  secret?: boolean;
}

export interface VerifyResult {
  ok: boolean;
  /** Shown under the step. On failure this is the whole explanation. */
  detail?: string;
  /** Something the user can go and do about it, when there is one. */
  help?: { label: string; url: string };
  /**
   * How to fix it, one plain-language instruction per entry, rendered as a
   * numbered list. For someone who has never installed developer tooling this
   * is the difference between a wall and a path, each failure mode can carry
   * its own walkthrough ("install it" and "start it" are different journeys).
   */
  guide?: string[];
}

/**
 * Values a step wrote for later steps to read, the env file's contents, the
 * chosen model. A plain bag rather than a typed record: steps are data, and
 * the set of keys is theirs to decide.
 */
export type SetupBag = Record<string, string>;

export interface StepContext {
  ports: SetupPorts;
  config: SetupConfig;
  /** What the user typed into this step's fields. */
  input: Readonly<Record<string, string>>;
  bag: SetupBag;
  /** Appends a line to this step's log, which the user can expand. */
  log(line: string): void;
}

export interface SetupStep {
  id: string;
  title: string;
  description: string;
  /**
   * Skippable, and skipping still leaves a working product. The wizard offers
   * a Skip button for exactly these.
   */
  optional?: boolean;
  fields?: StepField[];
  /** Does the work. Throwing fails the step with the thrown message. */
  execute(context: StepContext): Promise<void>;
  /**
   * Proves the work landed. The next step does not unlock until this returns
   * ok, "it ran without error" is not the same as "it worked", and the whole
   * point of the wizard is that the user can believe the green check.
   */
  verify(context: StepContext): Promise<VerifyResult>;
}

/** One step, as the renderer draws it. */
export interface StepView {
  id: string;
  title: string;
  description: string;
  optional: boolean;
  fields: StepField[];
  status: StepStatus;
  /** Failure message. Null unless status is "failed". */
  error: string | null;
  help: { label: string; url: string } | null;
  detail: string | null;
  /** Numbered walkthrough for the current failure, empty when there is none. */
  guide: string[];
  logs: string[];
}

export interface SetupSnapshot {
  steps: StepView[];
  /** The step the wizard is showing. */
  currentIndex: number;
  /** True once every step is done or skipped. */
  complete: boolean;
  running: boolean;
  /**
   * Parked in front of an optional step, waiting for the user to accept or
   * skip it. The wizard shows its fields and both buttons.
   */
  awaitingDecision: boolean;
}
