/**
 * The vocabulary of a **Decision** (CONTEXT.md, spec #948): one `evaluate` call
 * of the decision model, a state plus a **question map** answered with typed
 * choices and probabilities, never prose.
 *
 * These are structural twins of the AI SDK's evaluation question and answer
 * shapes. They are declared here rather than imported because this package has
 * zero dependencies (ADR-0019), and they stay narrower than the SDK's (string
 * instructions and criteria only, no JSON state inside a question) so that
 * every value built from them is assignable to the SDK's types by structure.
 * `packages/agent` is where the two meet, in `decide()`; a test there replays
 * the labelled fixtures through the SDK's own validation, which is what keeps
 * the twins honest.
 *
 * Two rules from the map (#937) shape everything below:
 * - **Pick a card from the deck.** A choice is always among options code
 *   supplied, with an explicit exit (`other`, `none`); nothing here extracts a
 *   free value.
 * - **A decision under threshold has an information-preserving exit.** The
 *   threshold check therefore fails closed on missing confidence, and the
 *   caller's fallback is always today's path.
 */

export interface DecisionChoiceQuestion {
  readonly type: "choice";
  readonly instructions: string;
  /** Option name → the situation it names. Nonempty; at most CHOICE_OPTION_CAP. */
  readonly criteria: Readonly<Record<string, string>>;
}

export interface DecisionScoreQuestion {
  readonly type: "score";
  readonly instructions: string;
  /** Ordered levels, indexed from zero; two to SCORE_LEVEL_CAP of them. */
  readonly criteria: readonly string[];
}

export interface DecisionBooleanQuestion {
  readonly type: "boolean";
  readonly instructions: string;
  readonly criteria?: { readonly true?: string; readonly false?: string };
}

export type DecisionQuestion =
  | DecisionChoiceQuestion
  | DecisionScoreQuestion
  | DecisionBooleanQuestion;

/** Jev's option and level limits; the SDK and the provider enforce the same. */
export const CHOICE_OPTION_CAP = 255;
export const SCORE_LEVEL_CAP = 10;

export interface DecisionChoiceAnswer<Option extends string = string> {
  readonly type: "choice";
  readonly choice: Option;
  /** The full distribution when the backend supplies one (Jev does, the adapter never). */
  readonly probabilities?: Readonly<Record<string, number>>;
}

export interface DecisionScoreAnswer {
  readonly type: "score";
  /** Fractional position in [0, levels - 1]: the probability-weighted mean. */
  readonly score: number;
  readonly probabilities?: Readonly<Record<string, number>>;
}

export interface DecisionBooleanAnswer {
  readonly type: "boolean";
  /** P(true). Not a confidence in either outcome. */
  readonly probability: number;
}

export type DecisionAnswer =
  | DecisionChoiceAnswer
  | DecisionScoreAnswer
  | DecisionBooleanAnswer;

/** The answer shape a given question produces, with the choice narrowed to its options. */
export type AnswerFor<Q extends DecisionQuestion> = Q extends DecisionChoiceQuestion
  ? DecisionChoiceAnswer<keyof Q["criteria"] & string>
  : Q extends DecisionScoreQuestion
    ? DecisionScoreAnswer
    : DecisionBooleanAnswer;

export type AnswersFor<M extends Readonly<Record<string, DecisionQuestion>>> = {
  readonly [Id in keyof M]: AnswerFor<M[Id]>;
};

/** Jev's calibrated confidence per question id (Choice and Score only). */
export type DecisionConfidence = Readonly<Record<string, number>>;

/**
 * Whether the adapter fallback answered rather than Jev: the SDK never
 * synthesises a distribution, so a Choice or Score with no `probabilities` can
 * only have come from the structured-output adapter. A Boolean cannot tell.
 */
export function answeredByFallback(answer: DecisionAnswer): boolean {
  return answer.type !== "boolean" && answer.probabilities === undefined;
}

/**
 * The one threshold rule (#942, #943).
 *
 * - Calibrated (Jev): a Choice or Score clears when its confidence, read from
 *   the provider metadata and **never** from the selected option's own
 *   probability, is at least the threshold. Missing confidence fails closed.
 *   A Boolean clears when P(true) is at least the threshold.
 * - Uncalibrated (the adapter): thresholds degrade to "accept the choice", a
 *   Choice or Score always clears, and the only defensible Boolean cut is 0.5.
 */
export function clearsThreshold(input: {
  answer: DecisionAnswer;
  /** `confidence[questionId]` from the decision; undefined under the adapter. */
  confidence: number | undefined;
  threshold: number;
  calibrated: boolean;
}): boolean {
  const { answer, confidence, threshold, calibrated } = input;
  if (answer.type === "boolean") {
    return answer.probability >= (calibrated ? threshold : 0.5);
  }
  if (!calibrated) return true;
  return typeof confidence === "number" && confidence >= threshold;
}

/**
 * The level a Score answer lands on: the nearest whole level to its weighted
 * mean. Scores are positions, so `1.49` is level 1 and `1.5` is level 2.
 */
export function scoreLevel(answer: DecisionScoreAnswer, levels: number): number {
  const rounded = Math.round(answer.score);
  return Math.min(Math.max(rounded, 0), Math.max(levels - 1, 0));
}

export interface CompositePart {
  /** A Score answer's position, in [0, levels - 1]. */
  score: number;
  /** How many levels that question has; normalises the position to [0, 1]. */
  levels: number;
  /** The weight this dimension carries. Weights are owned in code (#937). */
  weight: number;
}

/**
 * Composite scoring in code: one Score per dimension, weights ours. Returns a
 * value in [0, 1], the weighted mean of each part's normalised position; zero
 * total weight scores zero rather than dividing by it.
 */
export function compositeScore(parts: readonly CompositePart[]): number {
  let weighted = 0;
  let total = 0;
  for (const part of parts) {
    const span = Math.max(part.levels - 1, 1);
    const position = Math.min(Math.max(part.score, 0), span) / span;
    weighted += position * part.weight;
    total += part.weight;
  }
  return total > 0 ? weighted / total : 0;
}
