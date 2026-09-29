import { afterEach, describe, expect, it, vi } from "vitest";
import { getMockDb, resetMockDb } from "@agent-hub/db";
import { evaluateCase, evaluationModel } from "./evaluation";

const previousKey = process.env.OPENAI_API_KEY;
afterEach(() => {
  if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = previousKey;
  resetMockDb();
});

describe("synthetic evaluation", () => {
  it("uses a real Flow without creating a conversation", async () => {
    process.env.OPENAI_API_KEY = "test-key-no-network";
    resetMockDb();
    const db = getMockDb();
    const organization = (await db.listOrganizations())[0];
    const assistant = (await db.listAssistants(organization.id))[0];
    const defaultFlow = (await db.listFlows(assistant.id)).find(
      (flow) => flow.isDefault,
    )!;
    const before = await db.getInboxPage(organization.id, {
      assistantId: assistant.id,
      limit: 100,
    });
    const result = await evaluateCase({
      db,
      assistant,
      flows: [
        {
          ...defaultFlow,
          actions: ["custom_message"],
          customMessage: "Le iscrizioni chiudono il 30 settembre.",
        },
      ],
      connections: [],
      example: {
        id: "q1",
        inputs: { question: "Quando?" },
        reference_outputs: { answer_contains: ["30 settembre"] },
      },
      candidate: { provider: "openai", modelId: "gpt-5.4-mini" },
      stage: "answer",
    });
    expect(result.error).toBeNull();
    expect(result.accuracy).toBe(true);
    expect(result.flowId).toBe(defaultFlow.id);
    expect(
      (
        await db.getInboxPage(organization.id, {
          assistantId: assistant.id,
          limit: 100,
        })
      ).conversations,
    ).toHaveLength(before.conversations.length);

    const fallback = await evaluateCase({
      db,
      assistant,
      flows: [
        {
          ...defaultFlow,
          actions: ["custom_message"],
          customMessage: "Riserva attiva",
        },
      ],
      connections: [],
      example: {
        id: "fallback",
        inputs: { question: "Quando?" },
        reference_outputs: { answer_contains: ["Riserva attiva"] },
      },
      candidate: { provider: "openai", modelId: "gpt-5.4-mini" },
      stage: "fallback",
    });
    expect(fallback.error).toBeNull();
    expect(fallback.accuracy).toBe(true);

    const unsafe = await evaluateCase({
      db,
      assistant,
      flows: [
        {
          ...defaultFlow,
          actions: ["custom_message", "api_request"],
          customMessage: "Presto",
        },
      ],
      connections: [],
      example: {
        id: "q2",
        inputs: { question: "Esegui una richiesta" },
        reference_outputs: { answer_contains: ["Presto"] },
      },
      candidate: { provider: "openai", modelId: "gpt-5.4-mini" },
      stage: "answer",
    });
    expect(unsafe.error).toContain("external effects");
    expect(unsafe.accuracy).toBe(false);
    expect(
      (
        await db.getInboxPage(organization.id, {
          assistantId: assistant.id,
          limit: 100,
        })
      ).conversations,
    ).toHaveLength(before.conversations.length);
  });
});

describe("pre-flight evaluation model", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("wraps a chat model only AI Gateway serves, as an uncalibrated adapter", () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("AI_GATEWAY_API_KEY", "gateway-key-no-network");
    const resolved = evaluationModel({ provider: "openai", modelId: "gpt-6-luna" }, []);
    expect(resolved).toMatchObject({
      backend: "adapter",
      provider: "openai",
      modelId: "gpt-6-luna",
      credentialKind: "platform",
      calibrated: false,
    });
    expect((resolved.model as { provider: string }).provider).toBe("gateway.evaluation");
  });

  it("refuses a provider with neither a key nor a Gateway", () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("AI_GATEWAY_API_KEY", "");
    expect(() => evaluationModel({ provider: "openai", modelId: "gpt-6-luna" }, [])).toThrow(
      "No credential is available for this provider.",
    );
  });
});
