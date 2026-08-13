import { generateObject } from "ai";
import type { LanguageModel } from "ai";
import { z } from "zod";
import type { Db } from "@agent-hub/db";
import { raiseOrAttachImprovement } from "@agent-hub/db";
import type { AiCredentialKind, Provider, VerifiableAnswer } from "@agent-hub/core";

import type { ChatReplyPart } from "./types";
import { getClassifierModel } from "./models";
import { meterUsage, usageTotals } from "./usage";

/**
 * Independent answer verifier (spec: nothing grades its own homework).
 * A scheduled pass re-reads recent generative answers with fresh eyes — only
 * the question, the answer text, and the cited Concepts' content re-fetched
 * at grade time; never the answering model's prompts or tool traces — and
 * records a one-line verdict per message. Out-of-band by design: a Visitor's
 * answer never waits on a second model call.
 */

const VERDICT_SCHEMA = z.object({
  verdict: z.enum(["pass", "fail"]),
  reason: z.string().max(400),
});

const VERIFIER_SYSTEM = [
  "You are an independent quality verifier for a support assistant. You receive a user question, the assistant's answer, and the content of the knowledge Concepts the answer cited.",
  "Judge only what is in front of you. PASS when every factual claim in the answer is supported by the cited content (or the answer honestly says it doesn't know). FAIL when the answer contradicts the cited content, asserts facts the content does not support, or answers a different question.",
  "The assistant was confident — that is not evidence. Output only the verdict and a one-sentence reason.",
].join(" ");

export interface VerifierResult {
  /** Candidates returned by the query this tick. */
  candidates: number;
  /** Verdicts actually recorded. */
  verified: number;
  /** Of those, how many failed. */
  failed: number;
}

/**
 * Claim staleness with slack: a claimed-but-ungraded answer is re-claimable
 * after ~12h, so a crashed tick's candidates return on the next daily tick
 * rather than staying stuck forever.
 */
const VERIFIER_CLAIM_STALE_MS = 12 * 3_600_000;

export async function runDueAnswerVerifications(
  deps: { db: Db },
  options: {
    limit?: number;
    /** Per-org fairness cap per tick. */
    perOrgCap?: number;
    /** Test seam: overrides the resolved grading model. */
    model?: LanguageModel;
    /** Test seam: overrides the claim staleness cutoff. */
    staleBefore?: string;
  } = {}
): Promise<VerifierResult> {
  const { db } = deps;
  const limit = options.limit ?? 20;
  const perOrgCap = options.perOrgCap ?? 5;
  // Atomic claim before grading: overlapping ticks never pay to grade the same
  // answer twice. The one-verdict-per-message constraint stays the backstop.
  const staleBefore =
    options.staleBefore ??
    new Date(Date.now() - VERIFIER_CLAIM_STALE_MS).toISOString();
  const candidates = await db.claimUnverifiedAnswers({ limit, staleBefore });

  const perOrg = new Map<string, number>();
  let verified = 0;
  let failed = 0;
  for (const candidate of candidates) {
    const used = perOrg.get(candidate.organizationId) ?? 0;
    // Over the fairness cap this tick: release the claim so the next tick
    // grades it rather than waiting for the claim to expire.
    if (used >= perOrgCap) {
      await db.releaseAnswerVerifierClaim(candidate.messageId).catch(() => {});
      continue;
    }
    const outcome = await verifyOne(db, candidate, options.model);
    if (!outcome) {
      // Skipped (no credential, malformed output, or a grading error): release
      // the claim so a later tick can retry immediately.
      await db.releaseAnswerVerifierClaim(candidate.messageId).catch(() => {});
      continue;
    }
    perOrg.set(candidate.organizationId, used + 1);
    verified += 1;
    if (outcome === "fail") failed += 1;
  }
  return { candidates: candidates.length, verified, failed };
}

/**
 * Grades one answer. Returns the recorded verdict, or null when the
 * candidate was skipped (no credential, malformed output, already verified)
 * — a skipped candidate simply stays unverified for a later tick; one bad
 * candidate never fails the run.
 */
async function verifyOne(
  db: Db,
  candidate: VerifiableAnswer,
  modelOverride?: LanguageModel
): Promise<"pass" | "fail" | null> {
  try {
    const parts = candidate.content as ChatReplyPart[];
    const answer = parts
      .filter(
        (p): p is Extract<ChatReplyPart, { type: "text" }> =>
          p.type === "text" && p.action === "search_knowledge"
      )
      .map((p) => p.text)
      .join("\n\n")
      .trim();
    if (!answer) return null;

    const sources = parts
      .filter(
        (p): p is Extract<ChatReplyPart, { type: "sources" }> =>
          p.type === "sources"
      )
      .flatMap((p) => p.sources);

    // Mechanical rule, no model needed: a generative answer citing nothing
    // is ungrounded by construction.
    if (sources.length === 0) {
      const reason = "Ungrounded: the answer cites no Sources.";
      const saved = await db.recordAnswerVerdict({
        messageId: candidate.messageId,
        organizationId: candidate.organizationId,
        assistantId: candidate.assistantId,
        flowId: candidate.flowId,
        verdict: "fail",
        reason,
        modelId: "mechanical",
      });
      if (saved) await flagFailure(db, candidate, reason);
      return saved ? "fail" : null;
    }

    let model = modelOverride ?? null;
    let modelId = "test-model";
    let provider: Provider = "anthropic";
    let credentialKind: AiCredentialKind | null = null;
    if (!model) {
      const connections = await db.listProviderConnections(
        candidate.organizationId
      );
      const classifier = getClassifierModel("anthropic", connections);
      // No credential — leave the answer unverified rather than guess.
      if (!classifier) return null;
      model = classifier.model;
      modelId = classifier.modelId;
      provider = classifier.provider;
      credentialKind = classifier.credentialKind;
    }

    const excerpts = (
      await Promise.all(
        sources.slice(0, 5).map(async (s) => {
          if (!s.conceptId) return null;
          const concept = await db.getConcept(s.conceptId);
          return concept
            ? `## ${concept.frontmatter.title || concept.path}\n${concept.body.slice(0, 2_000)}`
            : null;
        })
      )
    )
      .filter(Boolean)
      .join("\n\n");

    const { object, usage } = await generateObject({
      model,
      schema: VERDICT_SCHEMA,
      system: VERIFIER_SYSTEM,
      prompt: [
        `User question: """${candidate.question ?? "(unknown)"}"""`,
        `Assistant answer: """${answer}"""`,
        `Cited Concept content:\n${excerpts || "(content unavailable — judge scope and internal consistency only)"}`,
      ].join("\n\n"),
    });

    await meterUsage(db, [
      {
        organizationId: candidate.organizationId,
        assistantId: candidate.assistantId,
        conversationId: candidate.conversationId,
        messageId: candidate.messageId,
        stage: "verify",
        provider,
        modelId,
        credentialKind,
        ...usageTotals(usage),
      },
    ]);

    const saved = await db.recordAnswerVerdict({
      messageId: candidate.messageId,
      organizationId: candidate.organizationId,
      assistantId: candidate.assistantId,
      flowId: candidate.flowId,
      verdict: object.verdict,
      reason: object.reason,
      modelId,
    });
    if (saved && object.verdict === "fail") {
      await flagFailure(db, candidate, object.reason);
    }
    return saved ? object.verdict : null;
  } catch (error) {
    console.error("[verifier] candidate skipped:", error);
    return null;
  }
}

/**
 * A FAIL becomes triageable evidence: attach the message to an already-open
 * Improvement from the same conversation (occurrence, not clone), or create
 * a new one titled from the question. Never lets a tracker write fail the
 * verification itself.
 */
async function flagFailure(
  db: Db,
  candidate: VerifiableAnswer,
  reason: string
): Promise<void> {
  await raiseOrAttachImprovement(
    db,
    candidate.organizationId,
    {
      title: `Verification failed: ${candidate.question ?? reason}`,
      messageId: candidate.messageId,
      conversationId: candidate.conversationId,
    },
    // Never let a tracker write fail the verification itself.
    { swallowErrors: true }
  );
}
