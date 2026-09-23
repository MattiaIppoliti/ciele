/**
 * The keyed replay (#951, #953): labelled pre-flight messages against the real
 * decision model, on demand and never in CI.
 *
 *   pnpm --filter @agent-hub/agent replay:preflight [--set all|labelled|synthetic] [--json <file>] [--baseline <file.ts>]
 *
 * Needs a platform key in the environment (`AI_GATEWAY_API_KEY` or
 * `TYPESAFE_AI_API_KEY`); with none, or when the resolver would fall back to
 * the adapter, it refuses rather than measure the wrong thing.
 *
 * Two sets replay, each against its own catalogue. `labelled` is the 43-case
 * hand-labelled set from #951; `synthetic` is the 150-case set built from a
 * public corpus (`preflight-synthetic-cases.ts`), three quarters Italian.
 * Both carry gold labels only; the model's answers and confidences come from
 * this run, never from the fixture.
 *
 * For every question it prints accuracy, then the **threshold sweep**: for
 * each candidate cut, how much traffic clears it and how often the cleared
 * answers were right, overall and per language, with the lowest cut that
 * reaches the target precision on enough cases (`suggestThreshold`). Per
 * language matters because #938 sets a threshold per language only when the
 * two differ by more than 0.05; the sweep says whether they do. `--json`
 * writes every observation so the numbers can be attached to the ticket and
 * re-analysed without spending again. `--baseline` writes the drift baseline
 * (`packages/core/src/testing/preflight-drift-baseline.ts`): the cases whose
 * routing matched the gold at the **current** thresholds, which is the set the
 * nightly drift replay (`src/preflight-drift.ts`) checks for regressions. Run
 * it whenever a threshold or a criterion changes. About 200 calls in all,
 * well under a cent.
 */
import { writeFileSync } from "node:fs";

import {
  FRUSTRATION_LEVELS,
  PREFLIGHT_MAP_VERSION,
  PREFLIGHT_MODEL_ID,
  PREFLIGHT_QUESTION_IDS,
  PREFLIGHT_THRESHOLDS,
  REASONING_LEVELS,
  buildPreflightQuestions,
  preflightRouting,
  scoreLevel,
  suggestThreshold,
  thresholdSweep,
  type CalibrationObservation,
  type PreflightQuestionId,
  type PreflightRouting,
} from "@agent-hub/core";
import { PREFLIGHT_GOLD_SETS, goldLanguage, goldRouting } from "@agent-hub/core/testing";
import { decide, resolveDecisionModel } from "../src/decision-model";

const labelledSet = PREFLIGHT_GOLD_SETS.find((set) => set.name === "labelled")!;
const syntheticSet = PREFLIGHT_GOLD_SETS.find((set) => set.name === "synthetic")!;

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const which = flag("--set") ?? "all";
const jsonOut = flag("--json");
const baselineOut = flag("--baseline");
const sets = which === "all" ? [labelledSet, syntheticSet] : which === "labelled" ? [labelledSet] : which === "synthetic" ? [syntheticSet] : null;
if (!sets) {
  console.error(`--set must be all, labelled or synthetic; got ${which}`);
  process.exit(2);
}

const resolved = resolveDecisionModel("anthropic", []);
if (!resolved || resolved.backend !== "jev") {
  console.error(
    "No Jev backend: set AI_GATEWAY_API_KEY or TYPESAFE_AI_API_KEY. The adapter has no calibrated confidence to measure."
  );
  process.exit(2);
}

interface Observation extends CalibrationObservation {
  set: string;
  caseId: string;
  question: PreflightQuestionId;
  language: string | null;
  got: string;
  want: string;
}
const observations: Observation[] = [];
const routingRows: { set: string; caseId: string; routed: PreflightRouting; gold: PreflightRouting; same: boolean }[] = [];
const latencies: number[] = [];
const resolvedModelIds = new Set<string>();

/** #938's rule: a per-language threshold only when the languages disagree by more than this. */
const PER_LANGUAGE_GAP = 0.05;
const TARGET_PRECISION = 0.95;
const MIN_ASKED = 20;

for (const set of sets) {
  const questions = buildPreflightQuestions(set.catalogue);
  console.log(`\n── ${set.name}: ${set.cases.length} cases ──`);
  for (const gold of set.cases) {
    const decision = await decide(resolved, { state: gold.message, questions });
    latencies.push(decision.latencyMs);
    resolvedModelIds.add(decision.resolvedModelId);
    const got = decision.answers;
    const language = goldLanguage(gold.labels);
    const record = (question: PreflightQuestionId, gotValue: string, want: string, confidence: number): void => {
      observations.push({ set: set.name, caseId: gold.id, question, language, got: gotValue, want, confidence, correct: gotValue === want });
    };

    record("flow", got.flow.choice, gold.labels.flow, decision.confidence.flow ?? 0);
    record("faq", got.faq.choice, gold.labels.faq, decision.confidence.faq ?? 0);
    // A Boolean has no confidence apart from P(true). Accuracy reads it at
    // today's threshold; the sweep below re-reads the same rows as "escalate
    // at this P(true)" and asks how often that was right.
    record("wants_human", String(got.wants_human.probability >= PREFLIGHT_THRESHOLDS.wants_human), String(gold.labels.wantsHuman), got.wants_human.probability);
    // The desk only matters when a human was wanted; otherwise both sides say none.
    if (gold.labels.wantsHuman) record("desk", got.desk.choice, gold.labels.desk, decision.confidence.desk ?? 0);
    record("reasoning", REASONING_LEVELS[scoreLevel(got.reasoning, REASONING_LEVELS.length)], gold.labels.reasoning, decision.confidence.reasoning ?? 0);
    record("frustration", String(scoreLevel(got.frustration, FRUSTRATION_LEVELS)), String(gold.labels.frustration), decision.confidence.frustration ?? 0);
    record("language", got.language.choice, gold.labels.language, decision.confidence.language ?? 0);

    const routed = preflightRouting(
      { answers: got, confidence: decision.confidence, calibrated: decision.calibrated },
      set.catalogue
    );
    const expected = goldRouting(gold.labels, set.catalogue);
    const same = JSON.stringify(routed) === JSON.stringify(expected);
    routingRows.push({ set: set.name, caseId: gold.id, routed, gold: expected, same });
    if (!same) console.log(`  ${gold.id}: routed ${JSON.stringify(routed)}, gold ${JSON.stringify(expected)}`);
  }
}

const pct = (m: number, a: number): string => (a === 0 ? "n/a" : `${Math.round((m / a) * 100)}%`);
const sorted = [...latencies].sort((a, b) => a - b);
console.log(`\nmodel requested ${resolved.modelId}, response named ${[...resolvedModelIds].join(", ")} (map written against ${PREFLIGHT_MODEL_ID})`);
console.log(`cases ${routingRows.length}, latency median ${sorted[Math.floor(sorted.length / 2)]} ms, p90 ${sorted[Math.floor(sorted.length * 0.9)]} ms`);
for (const set of sets) {
  const rows = routingRows.filter((r) => r.set === set.name);
  console.log(`routing agreement at today's thresholds, ${set.name}: ${pct(rows.filter((r) => r.same).length, rows.length)}`);
}

function sweepFor(question: PreflightQuestionId, language: string | null): CalibrationObservation[] {
  const rows = observations.filter((o) => o.question === question && (language === null || o.language === language));
  // Escalating at P(true) ≥ t is right when the label says a person was wanted.
  if (question === "wants_human") return rows.map((o) => ({ confidence: o.confidence, correct: o.want === "true" }));
  return rows;
}

/** Of the messages that did want a person, how many clear each cut. */
function wantsHumanRecall(): string {
  const wanted = observations.filter((o) => o.question === "wants_human" && o.want === "true");
  return thresholdSweep(wanted)
    .map((p) => `${p.threshold.toFixed(2)}:${Math.round(p.coverage * 100)}%`)
    .join("  ");
}

/** Accuracy reads the raw rows: for wants_human that is the Boolean at today's cut. */
function accuracyFor(question: PreflightQuestionId, language: string | null): CalibrationObservation[] {
  return observations.filter((o) => o.question === question && (language === null || o.language === language));
}

console.log("\n=== accuracy per question (all sets; wants_human at today's cut) ===");
console.log("question       all      it       en");
for (const id of PREFLIGHT_QUESTION_IDS) {
  const all = accuracyFor(id, null);
  const it = accuracyFor(id, "it");
  const en = accuracyFor(id, "en");
  const acc = (o: CalibrationObservation[]): string => pct(o.filter((x) => x.correct).length, o.length).padEnd(8);
  console.log(`${id.padEnd(14)} ${acc(all)} ${acc(it)} ${acc(en)}`);
}

console.log("\n=== threshold sweep: coverage → precision at each cut (all sets) ===");
console.log("question       today  " + thresholdSweep([]).map((p) => p.threshold.toFixed(2).padStart(9)).join(""));
for (const id of PREFLIGHT_QUESTION_IDS) {
  const points = thresholdSweep(sweepFor(id, null));
  const cells = points.map((p) => `${Math.round(p.coverage * 100)}%→${p.precision === null ? "n/a" : `${Math.round(p.precision * 100)}%`}`.padStart(9));
  console.log(`${id.padEnd(14)} ${PREFLIGHT_THRESHOLDS[id].toFixed(2).padEnd(6)} ${cells.join("")}`);
}

console.log(`wants_human recall of labelled "wanted a person" at each cut: ${wantsHumanRecall()}`);

console.log(`\n=== suggested cuts: lowest with precision ≥ ${TARGET_PRECISION} on ≥ ${MIN_ASKED} cases ===`);
console.log("question       today  all    it     en     per-language?");
for (const id of PREFLIGHT_QUESTION_IDS) {
  if (PREFLIGHT_THRESHOLDS[id] === 0) continue; // the two Scores route nothing on their own
  const pick = (language: string | null): string => {
    const s = suggestThreshold(sweepFor(id, language), { targetPrecision: TARGET_PRECISION, minAsked: MIN_ASKED });
    return s ? s.threshold.toFixed(2) : "none";
  };
  const all = pick(null);
  const it = pick("it");
  const en = pick("en");
  const split = it !== "none" && en !== "none" && Math.abs(Number(it) - Number(en)) > PER_LANGUAGE_GAP ? "yes, gap > 0.05" : "no";
  console.log(`${id.padEnd(14)} ${PREFLIGHT_THRESHOLDS[id].toFixed(2).padEnd(6)} ${all.padEnd(6)} ${it.padEnd(6)} ${en.padEnd(6)} ${split}`);
}

if (jsonOut) {
  writeFileSync(
    jsonOut,
    JSON.stringify(
      {
        ranAt: new Date().toISOString(),
        modelRequested: resolved.modelId,
        modelsNamed: [...resolvedModelIds],
        mapModelId: PREFLIGHT_MODEL_ID,
        thresholdsToday: PREFLIGHT_THRESHOLDS,
        latencyMs: { median: sorted[Math.floor(sorted.length / 2)], p90: sorted[Math.floor(sorted.length * 0.9)] },
        routing: routingRows,
        observations,
      },
      null,
      2
    )
  );
  console.log(`\nwrote ${observations.length} observations to ${jsonOut}`);
}

if (baselineOut) {
  const agreed = routingRows.filter((r) => r.same);
  const lines = [
    "import type { PreflightDriftCase } from \"./preflight-gold\";",
    "",
    "/**",
    " * The drift baseline (#953): the labelled messages the model routed to the",
    " * gold destination when the thresholds were set, at those thresholds. The",
    " * nightly replay re-routes exactly these and raises a `system` Alert when one",
    " * no longer lands where it did; a case the model already got wrong is not in",
    " * here, so a wrong answer that stays wrong is not drift.",
    " *",
    ` * Written by \`replay:preflight --baseline\` on ${new Date().toISOString().slice(0, 10)} against`,
    ` * \`${resolved.modelId}\` (map v${String(PREFLIGHT_MAP_VERSION)}): ${agreed.length} of ${routingRows.length} cases.`,
    " * Regenerate it whenever a threshold or a criterion changes.",
    " */",
    "export const PREFLIGHT_DRIFT_BASELINE: readonly PreflightDriftCase[] = [",
    ...agreed.map((r) => `  { set: "${r.set}", id: "${r.caseId}" },`),
    "];",
    "",
  ];
  writeFileSync(baselineOut, lines.join("\n"));
  console.log(`wrote ${agreed.length} baseline cases to ${baselineOut}`);
}
