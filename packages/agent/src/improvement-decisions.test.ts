import { beforeEach, describe, expect, it, vi } from "vitest";
import { Experimental_EvaluationMockModelV4 } from "ai/test";
import { defaultGuardrail } from "@agent-hub/core";
import { DEMO_ORG, getMockDb, type Db } from "@agent-hub/db";
import { runTriageDecision } from "./improvement-decisions";

/**
 * Feedback triage's decision (#959) under PII masking (#1080): the evidence is
 * a Visitor's question and the answer they flagged, so it goes out masked when
 * their Assistant masks. The decision backend is faked at its resolver; the
 * `decide()` it feeds is the real one, which is where the masking happens.
 * The fake answers nothing, so the SDK rejects the reply: these tests read
 * only what was sent.
 */

const sent = vi.hoisted(() => ({ requests: [] as string[] }));

vi.mock("./decision-model", async (importOriginal) => {
  const original = await importOriginal<typeof import("./decision-model")>();
  return {
    ...original,
    resolveDecisionModel: () => ({
      model: new Experimental_EvaluationMockModelV4({
        doEvaluate: async (options) => {
          sent.requests.push(JSON.stringify(options));
          return { answers: {}, usage: { inputTokens: 1, outputTokens: 0 }, warnings: [] };
        },
      }),
      backend: "jev",
      provider: "typesafe",
      modelId: "typesafe-ai/jev",
      credentialKind: "platform",
      calibrated: true,
    }),
  };
});

const db = getMockDb();

async function flaggedConversation(masking: boolean) {
  const assistant = await db.createAssistant(DEMO_ORG.id, { title: "Triage Masking" });
  if (masking) await db.updateAssistant(assistant.id, { guardrails: [defaultGuardrail("pii_masking", "pii")] });
  const conversation = await db.createConversation({
    assistantId: assistant.id,
    subjectType: "visitor",
    subjectId: `v-${crypto.randomUUID()}`,
    title: "t",
  });
  await db.appendMessage({
    conversationId: conversation.id,
    role: "user",
    content: [{ type: "text", text: "Refund to jane@example.com please" }],
  });
  return { id: conversation.id, assistantId: assistant.id };
}

const evidence = {
  title: "Refund to jane@example.com please",
  question: "Refund to jane@example.com please",
  answer: "I could not find that.",
};

beforeEach(() => {
  sent.requests.length = 0;
});

describe("runTriageDecision under PII masking (#1080)", () => {
  it("sends the evidence and the candidate titles masked", async () => {
    const conversation = await flaggedConversation(true);
    await runTriageDecision({
      evidence,
      candidates: [{ id: "imp-1", title: "Refund for jane@example.com" }],
      connections: [],
      db,
      conversation,
    }).catch(() => null);
    const shown = sent.requests.join("\n");
    expect(shown).toContain("Refund to [EMAIL_1] please");
    expect(shown).not.toContain("jane@example.com");
  });

  it("leaves an Assistant that masks nothing as it was", async () => {
    const conversation = await flaggedConversation(false);
    await runTriageDecision({ evidence, candidates: [], connections: [], db, conversation }).catch(() => null);
    expect(sent.requests.join("\n")).toContain("jane@example.com");
  });

  it("calls no model when the guardrail cannot be read", async () => {
    const conversation = await flaggedConversation(true);
    const broken = Object.assign(Object.create(db) as Db, {
      getLatestPublication: async () => {
        throw new Error("db down");
      },
    });
    await expect(
      runTriageDecision({ evidence, candidates: [], connections: [], db: broken, conversation })
    ).rejects.toThrow("db down");
    expect(sent.requests).toEqual([]);
  });
});
