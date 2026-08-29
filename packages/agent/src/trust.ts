import type { TrustSignal, TrustTier } from "@agent-hub/core";
import type { Db } from "@agent-hub/db";
import type { ChatReplyPart } from "./types";
import { alertKeys, signalHealth } from "./health";

/**
 * Flow trust ledger (spec: autonomy per capability, earned). Trust is a
 * rolling pass rate over the last TRUST_WINDOW graded signals per
 * (Assistant, Flow), verifier verdicts plus explicit Visitor feedback,
 * verdict winning when both grade the same message (enforced upstream by
 * the signals query). Thresholds are the article-derived platform
 * constants: 20 runs and 95% earn `auto`; under 10 runs or under 90% is
 * `watch`; everything between is `queue`. Trust must be losable, the
 * window rolls, it never accumulates for life.
 */

export const TRUST_WINDOW = 50;
export const TRUST_AUTO_MIN_RUNS = 20;
export const TRUST_AUTO_MIN_RATE = 0.95;
export const TRUST_WATCH_MAX_RUNS = 10;
export const TRUST_WATCH_MIN_RATE = 0.9;

/** Pure tier math, a new pair (0 runs) lands at watch by construction. */
export function computeTier(runs: number, passes: number): TrustTier {
  const rate = runs > 0 ? passes / runs : 0;
  if (runs >= TRUST_AUTO_MIN_RUNS && rate >= TRUST_AUTO_MIN_RATE) return "auto";
  if (runs < TRUST_WATCH_MAX_RUNS || rate < TRUST_WATCH_MIN_RATE) return "watch";
  return "queue";
}

/**
 * The one runtime behavior tiers have in v1: a watch-tier Flow's generative
 * answers always offer the human exit ramp. Pure so the rule is testable
 * without a model; the engine appends the help-desk part when this returns
 * true (deduplicated, escalate-on-ungrounded may already have added one).
 * Fail-open by construction: a missing tier (null) changes nothing.
 */
export function needsWatchEscalation(
  parts: ChatReplyPart[],
  tier: TrustTier | null
): boolean {
  if (tier !== "watch") return false;
  const generative = parts.some(
    (p) => p.type === "text" && p.action === "search_knowledge"
  );
  const hasHelpDesk = parts.some((p) => p.type === "help_desk");
  return generative && !hasHelpDesk;
}

export interface TrustMaterializationResult {
  /** (assistant, flow) pairs materialized this run. */
  pairs: number;
  /** Transitions into watch from a higher tier (each raised an Alert). */
  demotions: number;
}

/**
 * Nightly materialization: pure aggregation over the stored signals into
 * flow_trust rows. Idempotent, same signals, same tiers; only a tier
 * *transition* has side effects (demotion Alert / recovery auto-resolve).
 */
export async function runTrustMaterialization(
  deps: { db: Db },
  options: { signalLimit?: number } = {}
): Promise<TrustMaterializationResult> {
  const { db } = deps;
  const signals = await db.listTrustSignals({
    limit: options.signalLimit ?? 2_000,
  });

  const groups = new Map<string, TrustSignal[]>();
  for (const signal of signals) {
    const key = `${signal.assistantId}:${signal.flowId}`;
    const group = groups.get(key) ?? [];
    if (group.length < TRUST_WINDOW) group.push(signal); // signals arrive newest-first
    groups.set(key, group);
  }

  let demotions = 0;
  for (const group of groups.values()) {
    const { assistantId, flowId, organizationId } = group[0];
    const runs = group.length;
    const passes = group.filter((s) => s.pass).length;
    const tier = computeTier(runs, passes);

    const { previousTier } = await db.upsertFlowTrust({
      assistantId,
      flowId,
      organizationId,
      runs,
      passes,
      tier,
    });

    // Append-only demotion history: every genuine tier transition is recorded
    // so "when did this flow start failing?" survives the nightly snapshot
    // overwrite. The snapshot keeps only the last transition; the event ledger
    // keeps them all (bounded), and the compost digest reads demotions here.
    if (tier !== previousTier) {
      try {
        await db.recordFlowTrustEvent({
          organizationId,
          assistantId,
          flowId,
          fromTier: previousTier,
          toTier: tier,
          runs,
          passes,
        });
      } catch (error) {
        console.error("[trust] event append failed:", error);
      }
    }

    const key = alertKeys.flowTrust(flowId);
    if (
      tier === "watch" &&
      (previousTier === "auto" || previousTier === "queue")
    ) {
      demotions += 1;
      const failReasons = group
        .filter((s) => !s.pass)
        .slice(0, 3)
        .map((s) => s.reason)
        .filter(Boolean);
      await signalHealth(
        db,
        organizationId,
        {
          key,
          healthy: false,
          alert: {
            type: "system",
            title: `Flow demoted to watch: pass rate dropped`,
            detail: `The flow's rolling pass rate fell to ${passes}/${runs}. Recent failure reasons: ${
              failReasons.join(" · ") || "explicit negative feedback"
            }. Its answers now always offer human escalation until trust recovers.`,
          },
        },
        "trust"
      );
    } else if (tier !== "watch" && previousTier === "watch") {
      await signalHealth(db, organizationId, { key, healthy: true }, "trust");
    }
  }

  return { pairs: groups.size, demotions };
}
