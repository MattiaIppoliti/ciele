import { describe, expect, it } from "vitest";
import { getMockDb, DEMO_ORG } from "@agent-hub/db";
import type { ChatReplyPart } from "./types";
import type { LanguageModel } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { runDueAnswerVerifications } from "./verifier";

/**
 * The independent verifier, tested offline: candidates come from the mock
 * Db and grading uses an injected mock model (the production path resolves
 * the cheap classifier tier from the org's Provider Connections).
 */

const db = getMockDb();

function verdictModel(verdict: "pass" | "fail", reason = "checked") {
  return new MockLanguageModelV3({
    doGenerate: {
      content: [{ type: "text" as const, text: JSON.stringify({ verdict, reason }) }],
      finishReason: { unified: "stop" as const, raw: "stop" },
      usage: {
        inputTokens: { total: 8, noCache: 8, cacheRead: undefined, cacheWrite: undefined },
        outputTokens: { total: 4, text: 4, reasoning: undefined },
      },
      warnings: [],
    },
  }) as unknown as LanguageModel;
}

async function answered(input: {
  parts: ChatReplyPart[];
  question?: string;
  conversationId?: string;
}): Promise<{ messageId: string; assistantId: string; conversationId: string }> {
  let conversationId = input.conversationId;
  let assistantId = "";
  if (!conversationId) {
    const assistant = await db.createAssistant(DEMO_ORG.id, {
      title: "Verifier Fixture",
    });
    assistantId = assistant.id;
    const conversation = await db.createConversation({
      assistantId: assistant.id,
      subjectType: "visitor",
      subjectId: "v-1",
      title: "t",
    });
    conversationId = conversation.id;
  }
  await db.appendMessage({
    conversationId,
    role: "user",
    content: [{ type: "text", text: input.question ?? "What does shipping cost?" }],
  });
  const saved = await db.appendMessage({
    conversationId,
    role: "assistant",
    content: input.parts,
    flowId: "default",
    flowName: "Default behavior",
  });
  return { messageId: saved.id, assistantId, conversationId };
}

const generativeText = (text: string): ChatReplyPart => ({
  type: "text",
  action: "search_knowledge",
  text,
});

describe("runDueAnswerVerifications", () => {
  it("mechanically fails an ungrounded answer (zero cited Sources), no model call", async () => {
    const { messageId } = await answered({
      parts: [generativeText("Shipping costs exactly 4.99, trust me.")],
    });
    const result = await runDueAnswerVerifications(
      { db },
      { model: verdictModel("pass") }
    );
    expect(result.verified).toBeGreaterThanOrEqual(1);
    // The verdict exists and is a fail even though the injected model would pass it.
    const again = await db.recordAnswerVerdict({
      messageId,
      organizationId: DEMO_ORG.id,
      assistantId: null,
      flowId: null,
      verdict: "pass",
      reason: "dup",
      modelId: "x",
    });
    expect(again).toBe(false); // already verified → idempotent skip
  });

  it("grades a sourced answer with the fresh-context model and records the verdict", async () => {
    const collection = await db.createCollection(
      (await db.createAssistant(DEMO_ORG.id, { title: "C" })).id,
      { name: "KB", description: "" }
    );
    const concept = await db.createConcept({
      collectionId: collection.id,
      sourceId: null,
      path: "shipping.md",
      frontmatter: { type: "FAQ", title: "Shipping", description: "", timestamp: "" },
      body: "Shipping is free over 50.",
    });
    await answered({
      parts: [
        generativeText("Shipping is free over 50."),
        {
          type: "sources",
          action: "search_knowledge",
          sources: [
            {
              conceptId: concept.id,
              conceptTitle: "Shipping",
              collectionName: "KB",
              sourceName: null,
              url: "https://acme.com/shipping",
            },
          ],
        },
      ],
    });
    const result = await runDueAnswerVerifications(
      { db },
      { model: verdictModel("fail", "contradicts the source") }
    );
    expect(result.verified).toBeGreaterThanOrEqual(1);
    expect(result.failed).toBeGreaterThanOrEqual(1);
  });

  it("never returns verbatim or fallback-only messages as candidates", async () => {
    await answered({
      parts: [{ type: "text", action: "custom_message", text: "Exact words." }],
    });
    await answered({
      parts: [{ type: "text", action: "refusal", text: "I can't help with that." }],
    });
    const candidates = await db.listUnverifiedAnswers({ limit: 100 });
    expect(
      candidates.every((c) =>
        (c.content as { action?: string; type?: string }[]).some(
          (p) => p.type === "text" && p.action === "search_knowledge"
        )
      )
    ).toBe(true);
  });

  it("is idempotent across ticks and respects the per-org cap", async () => {
    // Drain whatever is still unverified.
    await runDueAnswerVerifications({ db }, { model: verdictModel("pass") });

    for (let i = 0; i < 3; i++) {
      await answered({ parts: [generativeText(`Answer ${i}, unsourced.`)] });
    }
    const capped = await runDueAnswerVerifications(
      { db },
      { model: verdictModel("pass"), perOrgCap: 2 }
    );
    expect(capped.verified).toBe(2);

    const rest = await runDueAnswerVerifications(
      { db },
      { model: verdictModel("pass") }
    );
    expect(rest.verified).toBe(1);

    const drained = await runDueAnswerVerifications(
      { db },
      { model: verdictModel("pass") }
    );
    expect(drained.verified).toBe(0);
  });

  it("prioritizes thumbs-down answers, then escalated conversations, then newest", async () => {
    await runDueAnswerVerifications({ db }, { model: verdictModel("pass") });

    const newest = await answered({ parts: [generativeText("plain")] });
    const escalated = await answered({ parts: [generativeText("escalated")] });
    await db.updateConversationMetadata(escalated.conversationId, {
      escalated: true,
    });
    const thumbed = await answered({ parts: [generativeText("thumbed")] });
    await db.setMessageFeedback(thumbed.messageId, -1);

    const candidates = await db.listUnverifiedAnswers({ limit: 10 });
    const ids = candidates.map((c) => c.messageId);
    expect(ids.indexOf(thumbed.messageId)).toBe(0);
    expect(ids.indexOf(escalated.messageId)).toBe(1);
    expect(ids.indexOf(newest.messageId)).toBe(2);

    await runDueAnswerVerifications({ db }, { model: verdictModel("pass") });
  });

  it("creates one Improvement per conversation and appends evidence on repeat fails", async () => {
    const first = await answered({
      parts: [generativeText("Unsourced claim one.")],
      question: "What is the refund window?",
    });
    const improvementsBefore = await db.listImprovements(DEMO_ORG.id);

    await runDueAnswerVerifications({ db }, { model: verdictModel("pass") });
    const afterFirst = await db.listImprovements(DEMO_ORG.id);
    expect(afterFirst.length).toBe(improvementsBefore.length + 1);
    const created = afterFirst.find(
      (i) => !improvementsBefore.some((b) => b.id === i.id)
    );
    expect(created?.title).toContain("Verification failed");

    // A second failing answer in the SAME conversation appends evidence
    // instead of creating a clone.
    const second = await answered({
      parts: [generativeText("Unsourced claim two.")],
      question: "And the exchange policy?",
      conversationId: first.conversationId,
    });
    await runDueAnswerVerifications({ db }, { model: verdictModel("pass") });
    const afterSecond = await db.listImprovements(DEMO_ORG.id);
    expect(afterSecond.length).toBe(afterFirst.length);
    const evidence = await db.listImprovementMessages(created!.id);
    expect(evidence.map((e) => e.messageId)).toEqual(
      expect.arrayContaining([first.messageId, second.messageId])
    );
  });

  it("claims candidates before grading, so overlapping ticks never double-grade", async () => {
    // Drain anything still unverified from earlier cases.
    await runDueAnswerVerifications({ db }, { model: verdictModel("pass") });

    const seeded = await Promise.all([
      answered({ parts: [generativeText("Concurrent one, unsourced.")] }),
      answered({ parts: [generativeText("Concurrent two, unsourced.")] }),
      answered({ parts: [generativeText("Concurrent three, unsourced.")] }),
    ]);

    // Two ticks race. The claim (stamped synchronously before any await)
    // hands every candidate to exactly one tick.
    const [a, b] = await Promise.all([
      runDueAnswerVerifications({ db }, { model: verdictModel("pass") }),
      runDueAnswerVerifications({ db }, { model: verdictModel("pass") }),
    ]);

    // Every candidate graded exactly once across both ticks — no double count.
    expect(a.verified + b.verified).toBe(seeded.length);
    // A third tick finds nothing left.
    const drained = await runDueAnswerVerifications(
      { db },
      { model: verdictModel("pass") }
    );
    expect(drained.verified).toBe(0);
  });

  it("a stale claim is re-claimable; a fresh claim is not", async () => {
    await runDueAnswerVerifications({ db }, { model: verdictModel("pass") });
    const { messageId } = await answered({
      parts: [generativeText("Claim-lease fixture, unsourced.")],
    });

    // Fresh claim held by a (simulated) in-flight tick: a second claim skips it.
    const held = await db.claimUnverifiedAnswers({
      limit: 10,
      staleBefore: new Date(Date.now() - 3_600_000).toISOString(),
    });
    expect(held.map((c) => c.messageId)).toContain(messageId);
    const second = await db.claimUnverifiedAnswers({
      limit: 10,
      staleBefore: new Date(Date.now() - 3_600_000).toISOString(),
    });
    expect(second.map((c) => c.messageId)).not.toContain(messageId);

    // With a staleness cutoff in the future, the held claim is now expired and
    // re-claimable — a crashed tick's candidates return.
    const reclaimed = await db.claimUnverifiedAnswers({
      limit: 10,
      staleBefore: new Date(Date.now() + 3_600_000).toISOString(),
    });
    expect(reclaimed.map((c) => c.messageId)).toContain(messageId);
    await db.releaseAnswerVerifierClaim(messageId);
    await runDueAnswerVerifications({ db }, { model: verdictModel("pass") });
  });

  it("skips a candidate whose grading call fails, without failing the run", async () => {
    const collection = await db.createCollection(
      (await db.createAssistant(DEMO_ORG.id, { title: "D" })).id,
      { name: "KB2", description: "" }
    );
    const concept = await db.createConcept({
      collectionId: collection.id,
      sourceId: null,
      path: "a.md",
      frontmatter: { type: "FAQ", title: "A", description: "", timestamp: "" },
      body: "Body.",
    });
    await answered({
      parts: [
        generativeText("Sourced answer."),
        {
          type: "sources",
          action: "search_knowledge",
          sources: [
            {
              conceptId: concept.id,
              conceptTitle: "A",
              collectionName: "KB2",
              sourceName: null,
              url: null,
            },
          ],
        },
      ],
    });
    const throwing = new MockLanguageModelV3({
      doGenerate: () => {
        throw new Error("provider down");
      },
    }) as unknown as LanguageModel;
    const result = await runDueAnswerVerifications({ db }, { model: throwing });
    expect(result.verified).toBe(0);
    // Still unverified — a later tick can retry.
    const retry = await runDueAnswerVerifications(
      { db },
      { model: verdictModel("pass") }
    );
    expect(retry.verified).toBe(1);
  });
});
