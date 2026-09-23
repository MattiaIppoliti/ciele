/**
 * The arithmetic behind a pre-flight threshold (#953).
 *
 * A threshold is a claim: "when the model reports at least this much
 * confidence on this question, it is right often enough to act without
 * checking". Two pure derivations make that claim checkable. `thresholdSweep`
 * takes the (confidence, correct) pairs a replay produced against labelled
 * messages and reports, for each candidate cut, how many messages clear it
 * (coverage) and how often the cleared ones were right (precision).
 * `suggestThreshold` picks the lowest cut whose precision meets a target on
 * enough cases to mean something.
 *
 * The other half is whether the labels themselves can be trusted. Two
 * labellers who disagree on a third of the messages have not produced a
 * ground truth, however confident each is; `cohenKappa` is the standard
 * chance-corrected agreement figure #953 asks to be recorded per question.
 *
 * Nothing here knows what a question is or reads a threshold: it is arithmetic
 * over pairs, so the replay script and the labelling tool can share it and a
 * unit test can pin it without a model.
 */

export interface CalibrationObservation {
  /** The model's reported confidence for one question on one message, 0..1. */
  confidence: number;
  /** Whether the model's answer matched the label. */
  correct: boolean;
}

export interface ThresholdPoint {
  threshold: number;
  /** Observations whose confidence is at least the threshold. */
  asked: number;
  correct: number;
  /** `correct / asked`; null when nothing cleared the cut. */
  precision: number | null;
  /** `asked / total`; the share of traffic this cut would route. */
  coverage: number;
}

/** 0.50, 0.55, …, 0.95: the cuts worth considering for a routing question. */
export const DEFAULT_THRESHOLD_CANDIDATES: readonly number[] = Array.from(
  { length: 10 },
  (_, i) => Math.round((0.5 + i * 0.05) * 100) / 100
);

export function thresholdSweep(
  observations: readonly CalibrationObservation[],
  candidates: readonly number[] = DEFAULT_THRESHOLD_CANDIDATES
): ThresholdPoint[] {
  const total = observations.length;
  return candidates.map((threshold) => {
    let asked = 0;
    let correct = 0;
    for (const o of observations) {
      if (o.confidence < threshold) continue;
      asked += 1;
      if (o.correct) correct += 1;
    }
    return {
      threshold,
      asked,
      correct,
      precision: asked === 0 ? null : correct / asked,
      coverage: total === 0 ? 0 : asked / total,
    };
  });
}

export interface ThresholdSuggestion {
  threshold: number;
  point: ThresholdPoint;
}

/**
 * The lowest candidate whose precision reaches `targetPrecision` on at least
 * `minAsked` observations, or null when no cut does. Lowest, because every
 * step up trades coverage for nothing once the target is met; `minAsked`,
 * because 3 of 3 right says nothing about the next hundred.
 */
export function suggestThreshold(
  observations: readonly CalibrationObservation[],
  options: { targetPrecision: number; minAsked: number; candidates?: readonly number[] }
): ThresholdSuggestion | null {
  for (const point of thresholdSweep(observations, options.candidates)) {
    if (point.asked < options.minAsked || point.precision === null) continue;
    if (point.precision >= options.targetPrecision) return { threshold: point.threshold, point };
  }
  return null;
}

export interface AgreementFigures {
  /** Items both labellers answered. */
  items: number;
  agreed: number;
  /** `agreed / items`; null with no items. */
  observed: number | null;
  /**
   * Cohen's kappa: agreement beyond what the two label distributions would
   * produce by chance. 1 is perfect, 0 is chance, negative is worse than
   * chance. Null with no items; 1 when both labellers used a single identical
   * label throughout, where the chance term is undefined and nothing was
   * disagreed.
   */
  kappa: number | null;
}

/**
 * Cohen's kappa over two parallel label sequences. A `null` on either side
 * means that labeller skipped the item, and the item is left out of the count
 * rather than read as a disagreement.
 */
export function cohenKappa(
  a: readonly (string | null)[],
  b: readonly (string | null)[]
): AgreementFigures {
  if (a.length !== b.length) {
    throw new RangeError(`label sequences differ in length: ${a.length} and ${b.length}`);
  }
  const countsA = new Map<string, number>();
  const countsB = new Map<string, number>();
  let items = 0;
  let agreed = 0;
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i];
    const y = b[i];
    if (x === null || y === null) continue;
    items += 1;
    if (x === y) agreed += 1;
    countsA.set(x, (countsA.get(x) ?? 0) + 1);
    countsB.set(y, (countsB.get(y) ?? 0) + 1);
  }
  if (items === 0) return { items, agreed, observed: null, kappa: null };
  const observed = agreed / items;
  let expected = 0;
  for (const [label, na] of countsA) expected += (na / items) * ((countsB.get(label) ?? 0) / items);
  const kappa = expected === 1 ? 1 : (observed - expected) / (1 - expected);
  return { items, agreed, observed, kappa };
}
