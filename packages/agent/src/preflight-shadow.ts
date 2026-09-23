import {
  CHOICE_OPTION_CAP,
  PREFLIGHT_MAP_VERSION,
  PREFLIGHT_MODEL_ID,
  PREFLIGHT_QUESTION_IDS,
  answeredByFallback,
  buildPreflightQuestions,
  preflightRouting,
  type PreflightCatalogue,
  type PreflightDecision,
  type PreflightFailure,
  type PreflightQuestionId,
  type PreflightRouting,
  type PreflightTraceAnswer,
  type PreflightTraceRecord,
} from "@agent-hub/core";

import { decide, type ResolvedDecisionModel } from "./decision-model";
import type { UsageEvent } from "./types";

/**
 * The shadow pre-flight (#952): one fan-out decision per Visitor message,
 * recorded on the turn's trace and metered, **routing nothing**.
 *
 * The slice exists to produce the traffic #953 sets its thresholds from, so two
 * properties matter more than anything the decision actually says.
 *
 * *It cannot change the turn.* Nothing here returns a Flow, emits a
 * `RuntimeEvent` or touches the reply. The caller starts it beside Intent
 * Classification and reads it afterwards; the record reaches the stored trace
 * and nothing else.
 *
 * *It cannot hold the turn past its budget.* A decision that hangs is the
 * failure mode that matters, not one that throws: #947 was exactly that shape,
 * where a stream that opened and then stalled left a promise pending forever
 * while the throwing case behaved. So the abort signal, which cancels the
 * request, and a plain timer, which nothing downstream can decline to honour,
 * both run, and the turn continues on whichever fires first.
 */

/**
 * The spec's budget. Measured round trips were 299 to 393 ms warm and 1.27 s
 * cold from Italy through the Frankfurt edge (#940), so this leaves a cold
 * start room to land and cuts anything that has stopped being a fast decision.
 */
export const PREFLIGHT_TIMEOUT_MS = 1_500;

/**
 * The record minus the one field the shadow cannot know: which Flow the turn
 * went on to take. The caller owns that, and keeping them on one record is the
 * point, it makes "what the pre-flight would have done" and "what happened" a
 * single row instead of a join.
 */
export type PreflightShadowRecord = Omit<PreflightTraceRecord, "routedFlowId">;

/**
 * What one pre-flight produced (#953): the record for the trace, and the
 * decision the record was derived from, kept beside it because routing needs
 * what the record does not carry (the spoken language's own threshold check,
 * the typed answers) and re-deriving it from the flattened rows would be a
 * second implementation of the same rule. `decision` is null on a failure.
 */
export interface PreflightOutcome {
  record: PreflightShadowRecord;
  decision: PreflightDecision | null;
}

export interface PreflightShadowInput {
  /**
   * The Visitor's message, and only it. The labelled set replays the bare
   * message as its state, so a richer state here would make the thresholds
   * derived from that set untransferable to live traffic.
   */
  message: string;
  catalogue: PreflightCatalogue;
  /** `null` when no key resolves: the shadow then records nothing at all. */
  resolved: ResolvedDecisionModel | null;
  /**
   * The FAQ Concepts most similar to the message, best first (#954), asked for
   * only when the catalogue will not fit the option cap. Absent, the shortlist
   * is a prefix and the record says so by omitting `ranked`.
   */
  rankFaqs?: () => Promise<readonly string[]>;
  /** The turn's signal, so an abandoned turn abandons its decision with it. */
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Pushes the decision's ledger row into the turn's usage events. */
  recordUsage: (usage: UsageEvent) => void;
}

/**
 * Runs the shadow and returns what to record, or `null` when there was nothing
 * to ask. Never throws and never rejects: a shadow that could fail a turn would
 * be worse than no shadow at all.
 */
export async function runPreflightShadow(
  input: PreflightShadowInput
): Promise<PreflightShadowRecord | null> {
  return (await runPreflight(input))?.record ?? null;
}

/**
 * The pre-flight itself (#952, #953): one decision over the message, the
 * record for the trace and the decision for whoever may act on it. The same
 * contract as the shadow: never throws, never rejects, never holds the turn
 * past its budget.
 */
export async function runPreflight(input: PreflightShadowInput): Promise<PreflightOutcome | null> {
  const { resolved } = input;
  if (!resolved) return null;

  const timeoutMs = input.timeoutMs ?? PREFLIGHT_TIMEOUT_MS;
  const base = {
    mapVersion: PREFLIGHT_MAP_VERSION,
    mapModelId: PREFLIGHT_MODEL_ID,
    resolvedModelId: resolved.modelId,
    backend: resolved.backend,
    calibrated: resolved.calibrated,
  };

  // An Assistant with more FAQs than Jev has option slots still has six other
  // questions worth asking. A prefix of the catalogue is a worse FAQ question
  // than a ranked shortlist would be (that prefilter belongs to #954), so the
  // counts go on the record instead: an FAQ chosen from 254 of 600 options is
  // not comparable with one chosen from all of them, and #953 needs to see
  // which rows those are rather than average them in.
  const faqCap = CHOICE_OPTION_CAP - 1;
  const totalFaqs = input.catalogue.faqs.length;
  const truncated = totalFaqs > faqCap;
  let ranked = false;
  let faqs = input.catalogue.faqs;
  if (truncated) {
    // The ranking is a vector search over the Assistant's knowledge, so a
    // failure there is the prefix, not a failed pre-flight.
    const order = input.rankFaqs ? await input.rankFaqs().catch(() => null) : null;
    ranked = order !== null;
    faqs = prefilterFaqs(input.catalogue.faqs, order ?? [], faqCap);
  }
  const catalogue: PreflightCatalogue = truncated ? { ...input.catalogue, faqs } : input.catalogue;
  const faqCatalogue = truncated
    ? { total: totalFaqs, offered: faqCap, ...(ranked ? { ranked: true } : {}) }
    : undefined;

  let questions;
  try {
    questions = buildPreflightQuestions(catalogue);
  } catch (error) {
    return {
      record: {
        ...base,
        latencyMs: 0,
        answers: [],
        wouldRoute: { kind: "fallback", reason: "other" },
        failure: { reason: "no_questions", message: thrown(error) },
        ...(faqCatalogue ? { faqCatalogue } : {}),
      },
      decision: null,
    };
  }

  const startedAt = performance.now();
  const outcome = await raceTimeout(
    (signal) => decide(resolved, { state: input.message, questions, abortSignal: signal }),
    { signal: input.signal, timeoutMs }
  );

  if (outcome.kind !== "ok") {
    const failure: PreflightFailure =
      outcome.kind === "timeout"
        ? { reason: "timeout", afterMs: timeoutMs }
        : { reason: "error", message: thrown(outcome.error) };
    return {
      record: {
        ...base,
        latencyMs: Math.round(performance.now() - startedAt),
        answers: [],
        wouldRoute: { kind: "fallback", reason: "other" },
        failure,
        ...(faqCatalogue ? { faqCatalogue } : {}),
      },
      decision: null,
    };
  }

  const decision = outcome.value;
  input.recordUsage(decision.usage);

  const asPreflight: PreflightDecision = {
    answers: decision.answers,
    confidence: decision.confidence,
    calibrated: decision.calibrated,
  };

  return {
    record: {
      ...base,
      // What the response named. On the Gateway that is the id we asked for
      // (#940); `base.resolvedModelId` was only ever the request.
      resolvedModelId: decision.resolvedModelId,
      backend: decision.backend,
      calibrated: decision.calibrated,
      latencyMs: decision.latencyMs,
      answers: traceAnswers(asPreflight),
      wouldRoute: preflightRouting(asPreflight, catalogue),
      ...(faqCatalogue ? { faqCatalogue } : {}),
    },
    decision: asPreflight,
  };
}

/**
 * What a pre-flight decided, or null when it decided nothing a turn may act
 * on: no decision (a failure), or a record without one. The routing inside is
 * already `fallback` for an under-threshold or uncalibrated answer, so a
 * caller reads one value for "may I act, and how".
 */
export function decidedRoute(outcome: PreflightOutcome | null): PreflightRouting | null {
  if (!outcome?.decision || outcome.record.failure) return null;
  return outcome.record.wouldRoute;
}

/**
 * The FAQ shortlist for an overflowing catalogue (#954): the ranked ids that
 * are FAQs of this Assistant, in rank order, then the rest of the catalogue in
 * its own order until the cap. Pure, so the shortlist rule is a test and not
 * a property of the search.
 */
export function prefilterFaqs<F extends { id: string }>(
  faqs: readonly F[],
  rankedIds: readonly string[],
  cap: number
): F[] {
  const byId = new Map(faqs.map((faq) => [faq.id, faq]));
  const picked: F[] = [];
  const seen = new Set<string>();
  for (const id of rankedIds) {
    const faq = byId.get(id);
    if (!faq || seen.has(id)) continue;
    picked.push(faq);
    seen.add(id);
    if (picked.length >= cap) return picked;
  }
  for (const faq of faqs) {
    if (seen.has(faq.id)) continue;
    picked.push(faq);
    seen.add(faq.id);
    if (picked.length >= cap) break;
  }
  return picked;
}

/**
 * A curated FAQ's stored answer, as the direct hit renders it (#954): the
 * body verbatim and what the Source citation needs. Read by the host, because
 * only the host can turn an FAQ id into a Concept and its Collection.
 */
export interface PreflightFaqAnswer {
  body: string;
  title: string;
  collectionName: string;
  url: string | null;
}

/** One row per question, in map order, confidence exactly as the provider sent it. */
function traceAnswers(decision: PreflightDecision): PreflightTraceAnswer[] {
  return PREFLIGHT_QUESTION_IDS.map((id: PreflightQuestionId) => {
    const answer = decision.answers[id];
    const value =
      answer.type === "choice"
        ? answer.choice
        : answer.type === "score"
          ? answer.score
          : answer.probability >= 0.5;
    const confidence = decision.confidence[id];
    return {
      id,
      value,
      ...(typeof confidence === "number" ? { confidence } : {}),
      fallback: answeredByFallback(answer),
    };
  });
}

type RaceOutcome<T> =
  | { kind: "ok"; value: T }
  | { kind: "timeout" }
  | { kind: "error"; error: unknown };

/**
 * Runs `work` under a signal that aborts on the turn's signal or on the budget,
 * and stops waiting independently when the budget passes. The second half is
 * not redundancy: aborting *asks* the work to stop, the timer is what
 * guarantees the caller stops waiting whether or not it obliges.
 */
async function raceTimeout<T>(
  work: (signal: AbortSignal) => Promise<T>,
  options: { signal?: AbortSignal; timeoutMs: number }
): Promise<RaceOutcome<T>> {
  const budget = AbortSignal.timeout(options.timeoutMs);
  const signal = options.signal ? AbortSignal.any([options.signal, budget]) : budget;

  let timer: ReturnType<typeof setTimeout> | undefined;
  const expiry = new Promise<RaceOutcome<T>>((resolve) => {
    timer = setTimeout(() => resolve({ kind: "timeout" }), options.timeoutMs);
  });

  try {
    return await Promise.race([
      work(signal).then(
        (value): RaceOutcome<T> => ({ kind: "ok", value }),
        (error: unknown): RaceOutcome<T> => ({ kind: "error", error })
      ),
      expiry,
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function thrown(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
