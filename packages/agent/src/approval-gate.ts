import {
  APPROVAL_GATE_MAP_VERSION,
  approvalReviewTitle,
  approvalVerdict,
  buildApprovalQuestions,
  type ApprovalSubject,
  type ApprovalVerdict,
} from "@agent-hub/core";

import { decide, type ResolvedDecisionModel } from "./decision-model";
import { getRuntimeHost } from "./host";
import type { Db } from "@agent-hub/db";

import type { ChatReplyPart, UsageEvent } from "./types";

/**
 * The approval gate's runtime half (#958): it asks, it judges, and it hands
 * back a verdict. It does not write the row and it does not run the action,
 * because both belong to the host that holds the Db and the operations layer;
 * keeping the judgement here is what makes it testable without either.
 *
 * The rule the gate carries out is in `@agent-hub/core`. This file is the call.
 */

/**
 * Shorter than the pre-flight's budget, and for the opposite reason. A shadow
 * that times out costs a missing row; a gate that times out holds up an action
 * a Member is waiting on, and the safe answer (ask a human) is already known
 * without asking the model at all.
 */
export const APPROVAL_GATE_TIMEOUT_MS = 1_000;

/**
 * How long a stopped action waits before the sweep gives up on it. A day,
 * because the person who can approve it is at work and an action nobody
 * answered for should lapse rather than run late.
 */
export const APPROVAL_EXPIRY_MS = 24 * 60 * 60 * 1_000;

export interface ApprovalGateResult {
  verdict: ApprovalVerdict;
  /** Null when no backend answered or the call failed. */
  backend: "jev" | "adapter" | null;
  calibrated: boolean | null;
  confidence: Record<string, number>;
  mapVersion: number;
}

/**
 * Runs the gate over one action. Never throws: a gate that could fail a turn
 * would be a gate that turns an outage into an error message instead of into
 * an approval request. Every failure path lands on the same safe verdict,
 * "ask a human", which is what `approvalVerdict(null)` returns.
 */
export async function runApprovalGate(input: {
  subject: ApprovalSubject;
  /** Null when no key resolves: the gate then asks a human rather than guessing. */
  resolved: ResolvedDecisionModel | null;
  signal?: AbortSignal;
  timeoutMs?: number;
  recordUsage?: (usage: UsageEvent) => void;
}): Promise<ApprovalGateResult> {
  const unjudged = (backend: "jev" | "adapter" | null): ApprovalGateResult => ({
    verdict: approvalVerdict(null),
    backend,
    calibrated: null,
    confidence: {},
    mapVersion: APPROVAL_GATE_MAP_VERSION,
  });

  // Switched off is indistinguishable from no backend, on purpose: both
  // callers already read `backend: null` as "no gate" and both already have a
  // test for it, so the flag needs no second branch anywhere.
  if (!getRuntimeHost().approvalGateEnabled()) return unjudged(null);

  // `backend: null` is the caller's signal that **no gate is configured**, as
  // distinct from one that was configured and failed. The two must not be
  // treated alike: a deployment that never had a decision key has not opted
  // into this feature and must behave exactly as it did before (user story
  // 24), while a key that stopped working is an outage, and an outage must not
  // become an approval.
  if (!input.resolved) return unjudged(null);

  const timeoutMs = input.timeoutMs ?? APPROVAL_GATE_TIMEOUT_MS;
  const budget = AbortSignal.timeout(timeoutMs);
  const signal = input.signal ? AbortSignal.any([input.signal, budget]) : budget;

  let timer: ReturnType<typeof setTimeout> | undefined;
  const expiry = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs);
  });

  try {
    // The same belt and braces as the shadow pre-flight: aborting asks the
    // backend to stop, the timer is what guarantees this call returns.
    const decision = await Promise.race([
      decide(input.resolved, {
        state: "",
        questions: buildApprovalQuestions(input.subject),
        abortSignal: signal,
      }).catch(() => null),
      expiry,
    ]);
    if (!decision) return unjudged(input.resolved.backend);

    input.recordUsage?.(decision.usage);
    return {
      verdict: approvalVerdict({
        answers: decision.answers,
        confidence: decision.confidence,
        calibrated: decision.calibrated,
      }),
      backend: decision.backend,
      calibrated: decision.calibrated,
      confidence: { ...decision.confidence },
      mapVersion: APPROVAL_GATE_MAP_VERSION,
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * The card a stopped action leaves in the transcript.
 *
 * It carries the catalogue's words for the action and the gate's reason, never
 * the action's arguments and never anything the model wrote: a card is read by
 * a Member deciding whether to let something run, and an argument that talked
 * its way onto that screen would be talking to the person with the authority.
 */
export function approvalCardPart(input: {
  approvalId: string;
  label: string;
  verdict: Extract<ApprovalVerdict, { kind: "review" }>;
}): ChatReplyPart {
  return {
    type: "action_approval",
    action: "approval_gate",
    approvalId: input.approvalId,
    label: input.label,
    reason: input.verdict.reason,
    reversibility: input.verdict.reversibility,
    title: approvalReviewTitle(input.verdict),
  };
}

/**
 * What the model is told when its action was stopped. Deliberately not an
 * error: the action has not failed, it is waiting, and a model told "failed"
 * retries, which is how one approval request becomes four.
 */
export const APPROVAL_PENDING_NOTE =
  "This action is waiting for a colleague to approve it. The card is already shown. Say so plainly and move on; do not try it again and do not work around it.";

/**
 * The sweep that closes a stopped action nobody answered (#958).
 *
 * The same compare-and-set a decision uses: a Member who clicked between the
 * list and this write has closed the row, and the sweep must not overwrite
 * their yes with an expiry and drop the action they approved.
 *
 * An expired approval is a refusal by silence, which is the safe direction: an
 * action nobody would authorise for a day is not one to run late.
 */
export async function expireDueActionApprovals(deps: {
  db: ApprovalSweepDb;
  now?: () => Date;
  limit?: number;
}): Promise<{ expired: number }> {
  const now = (deps.now ?? (() => new Date()))();
  const pending = await deps.db
    .table("actionApprovals")
    .list(
      { status: "pending" },
      { orderBy: "expiresAt", ascending: true, limit: deps.limit ?? 100 }
    );
  let expired = 0;
  for (const approval of pending) {
    if (new Date(approval.expiresAt) > now) continue;
    const settled = await deps.db.decideActionApproval(approval.id, {
      status: "expired",
      decidedBy: null,
      decidedByName: null,
      decidedAt: null,
    });
    if (settled) expired += 1;
  }
  return { expired };
}

/** The slice of the `Db` the sweep needs, so it can be faked in a test. */
type ApprovalSweepDb = Pick<Db, "table" | "decideActionApproval">;
