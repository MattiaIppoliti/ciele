import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultGuardrail } from "@agent-hub/core";
import { DEMO_ORG, getMockDb } from "@agent-hub/db";
import { getClassifierModel } from "./models";
import { draftImprovementProposal } from "./improvement-proposal";
import { maskedModel } from "./testing/masked-model";

/**
 * A Suggested Fix under PII masking (#1080). The draft becomes an FAQ any
 * Visitor can retrieve once a Member accepts it, so a Visitor's value must
 * never come back into it: the drafter sees placeholders, and the Member reads
 * neutral wording where they were. A value from knowledge comes back as it is.
 *
 * Its own file because `improvement-proposal.test.ts` replaces `generateObject`
 * for the whole module graph, and the masking happens inside the real one.
 * Only the classifier is faked, with the middleware `buildModel` would add.
 */

vi.mock("./models", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./models")>()),
  getClassifierModel: vi.fn(),
}));

const store = getMockDb();
// The demo store has no such policy; this Db's search finds it for any query.
const db = Object.assign(Object.create(store) as typeof store, {
  searchChunks: async () => [
    {
      conceptId: "concept-refunds",
      conceptTitle: "Refund policy",
      conceptPath: "refunds.md",
      collectionId: "col-1",
      collectionName: "Policies",
      sourceName: "policy.pdf",
      sourceId: "src-1",
      directAccess: false,
      resourceUrl: null,
      content: "Refund requests go to refunds@example.org within 30 days.",
      similarity: 0.9,
    },
  ],
});
const seen: string[] = [];

function drafter(draft: { draftQuestion: string; draftAnswer: string; rationale: string }) {
  const model = maskedModel(seen, JSON.stringify(draft));
  vi.mocked(getClassifierModel).mockReturnValue({
    model,
    provider: "anthropic",
    modelId: "fake-classifier",
    credentialKind: "api_key",
  } as unknown as ReturnType<typeof getClassifierModel>);
}

/** A flagged answer to a Visitor who gave their email, beside a refund policy. */
async function flaggedRefund(masking: boolean) {
  const assistant = await db.createAssistant(DEMO_ORG.id, { title: "Suggested Fix Masking" });
  if (masking) {
    await db.updateAssistant(assistant.id, { guardrails: [defaultGuardrail("pii_masking", "pii")] });
  }
  const conversation = await db.createConversation({
    assistantId: assistant.id,
    subjectType: "visitor",
    subjectId: `v-${crypto.randomUUID()}`,
    title: "t",
  });
  await db.appendMessage({
    conversationId: conversation.id,
    role: "user",
    content: [{ type: "text", text: "I am jane@example.com, how do I get a refund?" }],
  });
  const flagged = await db.appendMessage({
    conversationId: conversation.id,
    role: "assistant",
    content: [{ type: "text", text: "I don't know." }],
    flowId: "default",
    flowName: "Default behavior",
  });
  const improvement = await db.createImprovement(DEMO_ORG.id, {
    title: "Refund answer was wrong",
    messageId: flagged.id,
  });
  return { improvementId: improvement.id, messageId: flagged.id };
}

beforeEach(() => {
  seen.length = 0;
  vi.mocked(getClassifierModel).mockReset();
});

describe("draftImprovementProposal under PII masking (#1080)", () => {
  it("drafts from masked text, and turns the Visitor's values into neutral wording", async () => {
    const { improvementId, messageId } = await flaggedRefund(true);
    drafter({
      draftQuestion: "How does [EMAIL_1] get a refund?",
      draftAnswer: "Write to [EMAIL_2] within 30 days; we reply to [EMAIL_1].",
      rationale: "The answer to [EMAIL_1] missed the policy.",
    });
    await draftImprovementProposal({ db, improvementId, messageId });

    const shown = seen.join("\n");
    expect(shown).toContain("I am [EMAIL_1], how do I get a refund?");
    expect(shown).not.toContain("jane@example.com");
    // The policy reached the drafter masked too, under the next placeholder.
    expect(shown).toContain("go to [EMAIL_2] within 30 days");

    const proposal = await db.getImprovementProposal(improvementId);
    expect(proposal?.payload).toMatchObject({
      draftQuestion: "How does your email address get a refund?",
      // The knowledge value is restored: knowledge already holds it.
      draftAnswer: "Write to refunds@example.org within 30 days; we reply to your email address.",
      rationale: "The answer to your email address missed the policy.",
    });
    expect(JSON.stringify(proposal?.payload)).not.toContain("jane@example.com");
  });

  it("leaves an Assistant that masks nothing as it was", async () => {
    const { improvementId, messageId } = await flaggedRefund(false);
    drafter({ draftQuestion: "How do I get a refund?", draftAnswer: "Write to refunds@example.org.", rationale: "Missed it." });
    await draftImprovementProposal({ db, improvementId, messageId });
    expect(seen.join("\n")).toContain("jane@example.com");
    expect((await db.getImprovementProposal(improvementId))?.payload.draftAnswer).toBe("Write to refunds@example.org.");
  });
});
