import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEMO_ORG, getMockDb } from "@agent-hub/db";
import type { LanguageModel } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { getClassifierModel } from "./models";
import { runDueMemoryPromotionJobs } from "./jobs";

// The extraction model is faked at the provider seam: the handler's gates,
// transcript rendering, metering and upsert all run for real over the mock Db.
vi.mock("./models", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./models")>()),
  getClassifierModel: vi.fn(),
}));

const classifierMock = vi.mocked(getClassifierModel);

const db = getMockDb();

const memorySubject = (subjectId: string) => ({
  organizationId: DEMO_ORG.id,
  subjectId,
});

function extractionModel(facts: string[]) {
  return new MockLanguageModelV3({
    doGenerate: {
      content: [{ type: "text" as const, text: JSON.stringify({ facts }) }],
      finishReason: { unified: "stop" as const, raw: "stop" },
      usage: {
        inputTokens: { total: 40, noCache: 40, cacheRead: undefined, cacheWrite: undefined },
        outputTokens: { total: 12, text: 12, reasoning: undefined },
      },
      warnings: [],
    },
  }) as unknown as LanguageModel;
}

function deferredExtractionModel(
  facts: string[],
  started: () => void,
  resume: Promise<void>
) {
  return new MockLanguageModelV3({
    doGenerate: async () => {
      started();
      await resume;
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ facts }) }],
        finishReason: { unified: "stop" as const, raw: "stop" },
        usage: {
          inputTokens: {
            total: 40,
            noCache: 40,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: { total: 12, text: 12, reasoning: undefined },
        },
        warnings: [],
      };
    },
  }) as unknown as LanguageModel;
}

function fakeClassifier(facts: string[]) {
  classifierMock.mockReturnValue({
    model: extractionModel(facts),
    provider: "google",
    modelId: "fake-small-model",
    credentialKind: "byok",
  } as unknown as ReturnType<typeof getClassifierModel>);
}

/** One quiet SSO conversation with a short exchange, plus its due ledger row. */
async function seedConversation(options: {
  subjectType?: "sso" | "visitor";
  subjectId?: string;
  /** Extra message appended AFTER the job row (the superseded case). */
  laterMessage?: boolean;
}) {
  const assistant = await db.createAssistant(DEMO_ORG.id, { title: "Memory Fixture" });
  const conversation = await db.createConversation({
    assistantId: assistant.id,
    subjectType: options.subjectType ?? "sso",
    subjectId: options.subjectId ?? `sub-${Math.random().toString(36).slice(2)}`,
  });
  await db.appendMessage({
    conversationId: conversation.id,
    role: "user",
    content: [{ type: "text", text: "Please always ship to the Berlin office." }],
  });
  await db.appendMessage({
    conversationId: conversation.id,
    role: "assistant",
    content: [{ type: "text", text: "Noted, Berlin office it is." }],
  });
  const job = await db.createBackgroundJob({
    kind: "promote_memories",
    payload: {
      kind: "promote_memories",
      conversationId: conversation.id,
      organizationId: DEMO_ORG.id,
    },
    nextRunAt: new Date(Date.now() - 1000).toISOString(),
  });
  if (options.laterMessage) {
    // A message newer than the job means a later turn owns the extraction.
    await new Promise((resolve) => setTimeout(resolve, 5));
    await db.appendMessage({
      conversationId: conversation.id,
      role: "user",
      content: [{ type: "text", text: "One more thing…" }],
    });
  }
  return { assistant, conversation, job };
}

beforeEach(async () => {
  classifierMock.mockReset();
  await db.setMemoryEnabled(DEMO_ORG.id, false);
  await db.setOrgBudget(DEMO_ORG.id, {
    dailyTokenLimit: null,
    dailyEuroLimit: null,
    enforcement: "notify",
  });
});

describe("promote_memories job (registry seam, #664)", () => {
  it("promotes durable facts with provenance and meters the extraction spend", async () => {
    await db.setMemoryEnabled(DEMO_ORG.id, true);
    fakeClassifier(["Always ships to the Berlin office"]);
    const { conversation } = await seedConversation({});

    const usedBefore = await db.getOrgTokensUsedToday(DEMO_ORG.id);
    const result = await runDueMemoryPromotionJobs({ db });
    expect(result).toMatchObject({ claimed: 1, succeeded: 1, failed: 0 });

    const memories = await db.listMemories({
      organizationId: DEMO_ORG.id,
      subjectId: conversation.subjectId,
    });
    expect(memories).toHaveLength(1);
    expect(memories[0].text).toBe("Always ships to the Berlin office");
    expect(memories[0].conversationId).toBe(conversation.id);
    // Extraction spend lands on the org's daily token ledger (40 in + 12 out).
    expect(await db.getOrgTokensUsedToday(DEMO_ORG.id)).toBe(usedBefore + 52);
  });

  it("does nothing while the org toggle is off", async () => {
    fakeClassifier(["Should never be stored"]);
    const { conversation } = await seedConversation({});
    const result = await runDueMemoryPromotionJobs({ db });
    expect(result).toMatchObject({ claimed: 1, succeeded: 1 });
    expect(await db.listMemories(memorySubject(conversation.subjectId))).toHaveLength(0);
    expect(classifierMock).not.toHaveBeenCalled();
  });

  it("never extracts from anonymous Visitor conversations", async () => {
    await db.setMemoryEnabled(DEMO_ORG.id, true);
    fakeClassifier(["Should never be stored"]);
    const { conversation } = await seedConversation({ subjectType: "visitor" });
    await runDueMemoryPromotionJobs({ db });
    expect(await db.listMemories(memorySubject(conversation.subjectId))).toHaveLength(0);
    expect(classifierMock).not.toHaveBeenCalled();
  });

  it("skips extraction when the org's daily token budget is exhausted", async () => {
    await db.setMemoryEnabled(DEMO_ORG.id, true);
    fakeClassifier(["Should never be stored"]);
    const { assistant, conversation } = await seedConversation({});
    await db.setOrgBudget(DEMO_ORG.id, {
      dailyTokenLimit: 1,
      dailyEuroLimit: null,
      enforcement: "notify",
    });
    await db.recordAiUsage([
      {
        organizationId: DEMO_ORG.id,
        assistantId: assistant.id,
        stage: "generate",
        provider: "google",
        modelId: "m",
        inputTokens: 5,
        outputTokens: 5,
      },
    ]);
    const result = await runDueMemoryPromotionJobs({ db });
    expect(result).toMatchObject({ claimed: 1, succeeded: 1 });
    expect(await db.listMemories(memorySubject(conversation.subjectId))).toHaveLength(0);
    expect(classifierMock).not.toHaveBeenCalled();
  });

  it("defers to a fresher job when the conversation kept going", async () => {
    await db.setMemoryEnabled(DEMO_ORG.id, true);
    fakeClassifier(["Should not be extracted by the stale job"]);
    const { conversation } = await seedConversation({ laterMessage: true });
    const result = await runDueMemoryPromotionJobs({ db });
    expect(result).toMatchObject({ claimed: 1, succeeded: 1 });
    expect(await db.listMemories(memorySubject(conversation.subjectId))).toHaveLength(0);
  });

  it("does not recreate memories from a conversation erased after enqueue", async () => {
    await db.setMemoryEnabled(DEMO_ORG.id, true);
    fakeClassifier(["Should remain erased"]);
    const { conversation } = await seedConversation({});

    await db.deleteSubjectMemories(memorySubject(conversation.subjectId));
    const result = await runDueMemoryPromotionJobs({ db });

    expect(result).toMatchObject({ claimed: 1, succeeded: 1 });
    expect(await db.listMemories(memorySubject(conversation.subjectId))).toHaveLength(0);
  });

  it("does not recreate memories when erasure happens during extraction", async () => {
    await db.setMemoryEnabled(DEMO_ORG.id, true);
    let markStarted!: () => void;
    let resume!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const paused = new Promise<void>((resolve) => {
      resume = resolve;
    });
    classifierMock.mockReturnValue({
      model: deferredExtractionModel(
        ["Should remain erased while running"],
        markStarted,
        paused
      ),
      provider: "google",
      modelId: "fake-small-model",
      credentialKind: "byok",
    } as unknown as ReturnType<typeof getClassifierModel>);
    const { conversation } = await seedConversation({});

    const running = runDueMemoryPromotionJobs({ db });
    await started;
    await db.deleteSubjectMemories(memorySubject(conversation.subjectId));
    resume();
    await running;

    expect(await db.listMemories(memorySubject(conversation.subjectId))).toHaveLength(0);
  });

  it("stores nothing when the model finds nothing durable", async () => {
    await db.setMemoryEnabled(DEMO_ORG.id, true);
    fakeClassifier([]);
    const { conversation } = await seedConversation({});
    const result = await runDueMemoryPromotionJobs({ db });
    expect(result).toMatchObject({ claimed: 1, succeeded: 1 });
    expect(await db.listMemories(memorySubject(conversation.subjectId))).toHaveLength(0);
  });
});
