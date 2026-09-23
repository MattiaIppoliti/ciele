import {
  buildPreflightQuestions,
  describePreflightRouting,
  preflightRouting,
  type PreflightQuestionMap,
  type PreflightRouting,
} from "@agent-hub/core";
import {
  PREFLIGHT_DRIFT_BASELINE,
  PREFLIGHT_GOLD_SETS,
  goldRouting,
  type PreflightDriftCase,
  type PreflightGoldSet,
} from "@agent-hub/core/testing";
import type { Db } from "@agent-hub/db";

import { decide, resolveDecisionModel, type ResolvedDecisionModel } from "./decision-model";
import { alertKeys, signalHealth } from "./health";

/**
 * The nightly drift replay (#953): the labelled messages the model routed
 * right when the thresholds were set, routed again against the live model.
 *
 * The thresholds are a claim about a model version nobody can pin (the
 * Gateway echoes the id it was sent, #940), so the only way to know the claim
 * still holds is to keep asking. The baseline is the set of cases the model
 * got right at the current thresholds; a case in it that now lands somewhere
 * else is **drift**, and drift raises a `system` Alert that clears on the next
 * clean run. A case the model already got wrong is not in the baseline, so a
 * wrong answer that stays wrong is not drift and never pages anyone.
 *
 * Two things this deliberately does not do. It does not compare against the
 * gold of *every* case, because the model is right on about four in five and
 * an Alert that fires every night is an Alert nobody reads. And it does not
 * treat a backend that failed as drift: a call that threw is counted apart, so
 * a Gateway outage reads as an outage, not as the thresholds having moved.
 *
 * About 160 decisions a night, well under a cent, and nothing runs without a
 * calibrated backend: the adapter has no confidence to check a threshold on.
 */

export interface PreflightDriftRegression {
  set: string;
  id: string;
  routed: PreflightRouting;
  gold: PreflightRouting;
}

export interface PreflightDriftReport {
  /** Why nothing ran, when nothing did. */
  skipped?: "no_backend" | "empty_baseline";
  replayed: number;
  passed: number;
  regressed: PreflightDriftRegression[];
  /** Decisions that threw: counted, listed, and never read as drift. */
  failed: { set: string; id: string; error: string }[];
  /** The Organizations whose Alert was raised or cleared. */
  signalled: string[];
}

export interface PreflightDriftDeps {
  db: Db;
  /**
   * Who gets the Alert. A threshold is a platform fact, not a tenant's, so the
   * host passes the Organizations its platform owners belong to; an empty
   * list replays and reports but raises nothing.
   */
  organizationIds: readonly string[];
  /** Defaults to the platform key's Jev; null skips the run. */
  resolved?: ResolvedDecisionModel | null;
  baseline?: readonly PreflightDriftCase[];
  sets?: readonly PreflightGoldSet[];
}

export async function runPreflightDriftReplay(deps: PreflightDriftDeps): Promise<PreflightDriftReport> {
  const baseline = deps.baseline ?? PREFLIGHT_DRIFT_BASELINE;
  const sets = deps.sets ?? PREFLIGHT_GOLD_SETS;
  const resolved = deps.resolved === undefined ? resolveDecisionModel("anthropic", []) : deps.resolved;
  const report: PreflightDriftReport = { replayed: 0, passed: 0, regressed: [], failed: [], signalled: [] };

  if (!resolved || !resolved.calibrated) return { ...report, skipped: "no_backend" };
  if (baseline.length === 0) return { ...report, skipped: "empty_baseline" };

  const questionsBySet = new Map<string, PreflightQuestionMap>();
  for (const entry of baseline) {
    const set = sets.find((s) => s.name === entry.set);
    const gold = set?.cases.find((c) => c.id === entry.id);
    if (!set || !gold) {
      report.failed.push({ set: entry.set, id: entry.id, error: "not in the labelled sets" });
      continue;
    }
    let questions = questionsBySet.get(set.name);
    if (!questions) {
      questions = buildPreflightQuestions(set.catalogue);
      questionsBySet.set(set.name, questions);
    }
    report.replayed += 1;
    try {
      const decision = await decide(resolved, { state: gold.message, questions });
      const routed = preflightRouting(
        { answers: decision.answers, confidence: decision.confidence, calibrated: decision.calibrated },
        set.catalogue
      );
      const expected = goldRouting(gold.labels, set.catalogue);
      if (JSON.stringify(routed) === JSON.stringify(expected)) report.passed += 1;
      else report.regressed.push({ set: set.name, id: gold.id, routed, gold: expected });
    } catch (error) {
      report.failed.push({ set: set.name, id: gold.id, error: error instanceof Error ? error.message : String(error) });
    }
  }

  const key = alertKeys.preflightDrift();
  for (const organizationId of deps.organizationIds) {
    await signalHealth(
      deps.db,
      organizationId,
      report.regressed.length === 0
        ? { healthy: true, key }
        : {
            healthy: false,
            key,
            alert: {
              type: "system",
              title: `Pre-flight drift: ${report.regressed.length} labelled ${report.regressed.length === 1 ? "case" : "cases"} no longer route as labelled`,
              detail: `${describe(report.regressed)} The decision model's answers moved on messages it routed right when the thresholds were set; review the thresholds in the question map. This alert clears on the next clean nightly replay.`,
            },
          },
      "preflight-drift"
    );
    report.signalled.push(organizationId);
  }
  return report;
}

function describe(regressed: readonly PreflightDriftRegression[]): string {
  const shown = regressed
    .slice(0, 5)
    .map((r) => `${r.id} (${r.set}): now ${describePreflightRouting(r.routed)}, labelled ${describePreflightRouting(r.gold)}`);
  const more = regressed.length > 5 ? `, and ${regressed.length - 5} more` : "";
  return `${shown.join("; ")}${more}.`;
}
