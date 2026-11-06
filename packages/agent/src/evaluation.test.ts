import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultChannelAvailability } from "@agent-hub/core";
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


it("uses live holidays when evaluating synthetic answers", async () => {
  process.env.OPENAI_API_KEY = "test-key-no-network";
  const db = getMockDb();
  const organization = (await db.listOrganizations())[0];
  const assistant = await db.createAssistant(organization.id, { title: "Eval hours" });
  const today = new Date().toISOString().slice(0, 10);
  const schedule = await db.saveBusinessHours(organization.id, null, { name: "Closed evaluation office", timezone: "UTC", hours: defaultChannelAvailability().hours, holidays: [{ id: "today", name: "Closure", startDate: today, endDate: today, yearly: false }], isDefault: false });
  const office = await db.createFlow(assistant.id, { name: "Office", description: "office opening", actions: ["custom_message"], customMessage: "OPEN", conditions: [{ id: "gate", kind: "schedule", mode: "business_hours", businessHoursId: schedule.id, direction: "during" }] });
  const fallback = await db.createFlow(assistant.id, { name: "Fallback", actions: ["custom_message"], customMessage: "CLOSED" });
  const result = await evaluateCase({ db, assistant, flows: [office, { ...fallback, isDefault: true }], connections: [], example: { id: "hours-eval", inputs: { question: "office opening" }, reference_outputs: { answer_contains: ["CLOSED"] } }, candidate: { provider: "openai", modelId: "gpt-5.4-mini" }, stage: "answer" });
  expect(result.error).toBeNull();
  expect(result.flowId).toBe(fallback.id);
  expect(result.accuracy).toBe(true);
});
