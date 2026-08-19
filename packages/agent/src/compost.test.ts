import { describe, expect, it } from "vitest";
import { buildPublicationConfig } from "@agent-hub/core";
import { getMockDb, DEMO_ORG } from "@agent-hub/db";
import type { LanguageModel } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { COMPOST_PROPOSAL_TAG, renderDigest, runCompostPass } from "./compost";

/**
 * The compost loop, tested offline through the mock Db with an injected
 * proposal model. Its only writes are Improvements and compost-run records.
 */

const db = getMockDb();

function proposalModel(
  proposals: { kind: string; title: string; rationale: string; draft: string }[]
) {
  return new MockLanguageModelV3({
    doGenerate: {
      content: [{ type: "text" as const, text: JSON.stringify({ proposals }) }],
      finishReason: { unified: "stop" as const, raw: "stop" },
      usage: {
        inputTokens: { total: 9, noCache: 9, cacheRead: undefined, cacheWrite: undefined },
        outputTokens: { total: 3, text: 3, reasoning: undefined },
      },
      warnings: [],
    },
  }) as unknown as LanguageModel;
}

async function publishedAssistant(title: string) {
  const assistant = await db.createAssistant(DEMO_ORG.id, { title });
  const flows = await db.listFlows(assistant.id);
  await db.createPublication(
    assistant.id,
    buildPublicationConfig(assistant, flows, [])
  );
  return assistant;
}

/** Seeds one failed verdict as the week's exhaust for an assistant. */
async function seedExhaust(assistantId: string) {
  const conversation = await db.createConversation({
    assistantId,
    subjectType: "visitor",
    subjectId: "v-compost",
    title: "t",
  });
  const message = await db.appendMessage({
    conversationId: conversation.id,
    role: "assistant",
    content: [{ type: "text", action: "search_knowledge", text: "A wrong answer." }],
    flowId: "default",
    flowName: "Default behavior",
  });
  await db.recordAnswerVerdict({
    messageId: message.id,
    organizationId: DEMO_ORG.id,
    assistantId,
    flowId: "default",
    verdict: "fail",
    reason: "contradicts the shipping page",
    modelId: "test",
  });
  return { conversationId: conversation.id, messageId: message.id };
}

describe("renderDigest", () => {
  it("renders only present exhaust, bounded", () => {
    const text = renderDigest({
      failedVerdicts: [
        { messageId: "m1", conversationId: "c1", reason: "unsupported claim" },
      ],
      thumbsDown: [],
      escalatedConversations: 2,
      refusals: 0,
      goalViolations: [],
      demotedFlows: [],
    });
    expect(text).toContain("unsupported claim");
    expect(text).toContain("Escalated conversations: 2");
    expect(text).not.toContain("refusal");
  });
});

describe("runCompostPass", () => {
  it("records a verified-clean week for a quiet assistant, no proposals", async () => {
    await publishedAssistant("Compost Clean Fixture");
    const before = (await db.listImprovements(DEMO_ORG.id)).length;
    const result = await runCompostPass(
      { db },
      { model: proposalModel([]) }
    );
    expect(result.processed).toBeGreaterThanOrEqual(1);
    expect(result.clean).toBeGreaterThanOrEqual(1);
    expect((await db.listImprovements(DEMO_ORG.id)).length).toBe(before);
  });

  it("lands capped, tagged proposals with evidence and is idempotent per window", async () => {
    const assistant = await publishedAssistant("Compost Exhaust Fixture");
    const { messageId } = await seedExhaust(assistant.id);
    const before = (await db.listImprovements(DEMO_ORG.id)).length;

    const many = Array.from({ length: 3 }, (_, i) => ({
      kind: "faq",
      title: `Proposal ${i}`,
      rationale: "Recurring failed verification about shipping.",
      draft: "Q: What does shipping cost?\nA: Shipping is free over 50.",
    }));
    const result = await runCompostPass({ db }, { model: proposalModel(many) });
    expect(result.processed).toBeGreaterThanOrEqual(1);

    const after = await db.listImprovements(DEMO_ORG.id);
    // First proposal creates the tagged item; the rest dedup against it
    // (same evidence conversation) instead of cloning.
    expect(after.length).toBe(before + 1);
    const proposal = after.find((i) => i.title.includes("Proposal 0"));
    expect(proposal).toBeTruthy();
    const full = await db.getImprovement(proposal!.id);
    expect(full?.tags).toContain(COMPOST_PROPOSAL_TAG);
    expect(full?.description).toContain("Proposed draft");
    const evidence = await db.listImprovementMessages(proposal!.id);
    expect(evidence.map((e) => e.messageId)).toContain(messageId);

    // Same window again: assistant not due, nothing new happens.
    const second = await runCompostPass({ db }, { model: proposalModel(many) });
    expect(second.processed).toBe(0);
    expect((await db.listImprovements(DEMO_ORG.id)).length).toBe(before + 1);
  });

  it("degrades to zero proposals on malformed model output, still recording the run", async () => {
    const assistant = await publishedAssistant("Compost Broken Model Fixture");
    await seedExhaust(assistant.id);
    const throwing = new MockLanguageModelV3({
      doGenerate: () => {
        throw new Error("provider down");
      },
    }) as unknown as LanguageModel;
    const before = (await db.listImprovements(DEMO_ORG.id)).length;
    const result = await runCompostPass({ db }, { model: throwing });
    expect(result.processed).toBeGreaterThanOrEqual(1);
    expect((await db.listImprovements(DEMO_ORG.id)).length).toBe(before);
    // The run record landed: the window will not re-run tomorrow.
    const again = await runCompostPass({ db }, { model: throwing });
    expect(again.processed).toBe(0);
  });

  it("respects the org opt-out", async () => {
    await publishedAssistant("Compost OptOut Fixture");
    await db.setCompostOptOut(DEMO_ORG.id, true);
    const result = await runCompostPass({ db }, { model: proposalModel([]) });
    expect(result.processed).toBe(0);
    await db.setCompostOptOut(DEMO_ORG.id, false);
  });

  it("claims each due assistant, so overlapping ticks never double-digest a window", async () => {
    // Drain everything currently due so the fixture below is the only due one.
    await runCompostPass({ db }, { model: proposalModel([]) });
    const assistant = await publishedAssistant("Compost Concurrent Fixture");
    await seedExhaust(assistant.id);

    // Two ticks race. The claim is stamped synchronously at window start, so
    // exactly one tick sees the assistant as due.
    const model = proposalModel([
      { kind: "faq", title: "Only once", rationale: "r", draft: "d" },
    ]);
    const [a, b] = await Promise.all([
      runCompostPass({ db }, { model }),
      runCompostPass({ db }, { model }),
    ]);
    expect(a.processed + b.processed).toBe(1);
    expect(Math.min(a.processed, b.processed)).toBe(0);

    // A later sequential tick in the same window still finds it not-due.
    const third = await runCompostPass({ db }, { model: proposalModel([]) });
    expect(third.processed).toBe(0);
  });
});

describe("getCompostDigest demotions (from the event ledger)", () => {
  it("sees a mid-window demotion even after a later materialization overwrote the snapshot", async () => {
    const assistant = await publishedAssistant("Compost Demotion Window Fixture");
    const since = new Date(Date.now() - 3_600_000).toISOString();

    // auto → watch (the demotion), then watch → auto (recovery), both inside
    // the window. The nightly snapshot now reads auto, but the append-only
    // event ledger still holds the demotion.
    await db.recordFlowTrustEvent({
      organizationId: DEMO_ORG.id,
      assistantId: assistant.id,
      flowId: "demoted-then-recovered",
      fromTier: "auto",
      toTier: "watch",
      runs: 25,
      passes: 20,
    });
    await db.recordFlowTrustEvent({
      organizationId: DEMO_ORG.id,
      assistantId: assistant.id,
      flowId: "demoted-then-recovered",
      fromTier: "watch",
      toTier: "auto",
      runs: 45,
      passes: 44,
    });

    const digest = await db.getCompostDigest(assistant.id, since);
    expect(digest.demotedFlows.map((f) => f.flowId)).toContain(
      "demoted-then-recovered"
    );
    // The demotion carries the runs/passes at the moment it happened.
    const demotion = digest.demotedFlows.find(
      (f) => f.flowId === "demoted-then-recovered"
    );
    expect(demotion).toMatchObject({ runs: 25, passes: 20 });
  });
});
