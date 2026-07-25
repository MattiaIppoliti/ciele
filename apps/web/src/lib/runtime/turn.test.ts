import { afterEach, describe, expect, it } from "vitest";
import { buildPublicationConfig, getMockDb, DEMO_ORG } from "@agent-hub/db";
import type { Assistant, Db, Flow, RuntimeEventInput } from "@agent-hub/db";
import type { ChatReplyPart } from "./types";
import {
  RECENT_HISTORY_LIMIT,
  readFlowTrustTier,
  recordProviderHealth,
  streamConversationTurn,
  turnConnectionKind,
} from "./turn";
import {
  registerEnterpriseCapabilities,
  resetEnterpriseCapabilities,
} from "./ee";
import { needsWatchEscalation } from "./trust";
import type { RuntimeEvent } from "./types";

/**
 * The Conversation Turn module (see context.md), tested through its public
 * interface with the in-memory Db. With no Provider Connections the engine
 * takes the deterministic no-model path (ADR-0003), so these tests run
 * offline and cover what the module owns: conversation get-or-create with
 * the subject+assistant ownership guard, message persistence with flow
 * markers, and the ndjson stream framing.
 */

const db = getMockDb();

async function fixture() {
  const assistant = await db.createAssistant(DEMO_ORG.id, {
    title: "Turn Test Assistant",
  });
  const flows = await db.listFlows(assistant.id);
  return { assistant, flows };
}

async function runTurn(input: {
  assistant: Assistant;
  flows: Flow[];
  subjectId?: string;
  conversationId?: string | null;
  message?: string;
  faqQuestion?: boolean;
  signal?: AbortSignal;
}): Promise<RuntimeEvent[]> {
  const stream = await streamConversationTurn({
    db,
    assistant: input.assistant,
    flows: input.flows,
    connections: [],
    organizationId: DEMO_ORG.id,
    subjectType: "visitor",
    subjectId: input.subjectId ?? "visitor-1",
    conversationId: input.conversationId ?? null,
    message: input.message ?? "hello there",
    faqQuestion: input.faqQuestion,
    signal: input.signal ?? new AbortController().signal,
  });
  const text = await new Response(stream).text();
  return text
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as RuntimeEvent);
}

function doneEvent(events: RuntimeEvent[]) {
  const done = events.at(-1);
  if (done?.type !== "done") throw new Error(`last event was ${done?.type}`);
  return done;
}

describe("streamConversationTurn", () => {
  it("does not persist an assistant reply for an aborted turn", async () => {
    const { assistant, flows } = await fixture();
    const controller = new AbortController();
    controller.abort();

    const events = await runTurn({
      assistant,
      flows,
      message: "replace this turn",
      signal: controller.signal,
    });
    const started = events.find((event) => event.type === "turn");
    if (started?.type !== "turn") throw new Error("turn did not start");

    expect(events.some((event) => event.type === "done")).toBe(false);
    const messages = await db.listMessages(started.conversationId);
    expect(messages.map((message) => message.role)).toEqual(["user"]);
  });

  it("answers an FAQ quick reply verbatim with a citation and no flow run (#313)", async () => {
    const { assistant, flows } = await fixture();
    const collection = await db.createCollection(assistant.id, {
      name: "FAQ Collection",
    });
    await db.createConcept({
      collectionId: collection.id,
      sourceId: null,
      path: "faq/hours.md",
      frontmatter: { type: "FAQ", title: "What are the opening hours?" },
      body: "We are open 9–17, Monday to Friday.",
    });

    const events = await runTurn({
      assistant,
      flows,
      message: "What are the opening hours?",
      faqQuestion: true,
    });
    const flowEvent = events.find((e) => e.type === "flow");
    expect(flowEvent).toMatchObject({ flowName: "FAQ" });
    const parts = events
      .filter((e) => e.type === "part")
      .map((e) => (e as { part: ChatReplyPart }).part);
    expect(parts[0]).toMatchObject({
      type: "text",
      text: "We are open 9–17, Monday to Friday.",
    });
    expect(parts[1]).toMatchObject({
      type: "sources",
      sources: [
        expect.objectContaining({
          conceptTitle: "What are the opening hours?",
          collectionName: "FAQ Collection",
        }),
      ],
    });
    // Persisted like any turn.
    const done = doneEvent(events);
    const messages = await db.listMessages(done.conversationId);
    expect(messages.at(-1)?.flowName).toBe("FAQ");
  });

  it("falls through to the normal flow when the FAQ no longer exists (#313)", async () => {
    const { assistant, flows } = await fixture();
    const events = await runTurn({
      assistant,
      flows,
      message: "a question with no matching FAQ",
      faqQuestion: true,
    });
    const flowEvent = events.find((e) => e.type === "flow");
    expect(flowEvent).toBeDefined();
    expect(flowEvent).not.toMatchObject({ flowName: "FAQ" });
    expect(events.at(-1)?.type).toBe("done");
  });

  it("continues a handover inside the target Assistant's Publication (#314)", async () => {
    const { assistant, flows: targetFlows } = await fixture();
    const target = await db.createAssistant(DEMO_ORG.id, {
      title: "Specialist Assistant",
    });
    await db.createPublication(
      target.id,
      buildPublicationConfig(target, await db.listFlows(target.id), [])
    );
    const handoverFlow = await db.createFlow(assistant.id, {
      name: "Route to specialist",
      description: "specialist topics",
      trigger: "message",
      actions: ["handover"],
      actionSettings: { handover: { assistantId: target.id } },
    });

    const events = await runTurn({
      assistant,
      flows: [handoverFlow, ...targetFlows],
      message: "I need the specialist",
    });
    const flowEvents = events.filter((e) => e.type === "flow");
    // Two flow events: the source routing + the continuation's routing.
    expect(flowEvents.length).toBeGreaterThanOrEqual(2);
    const done = doneEvent(events);
    const messages = await db.listMessages(done.conversationId);
    const reply = messages.at(-1);
    // The persisted reply carries the ack AND the target's parts, with a
    // flow marker naming both sides of the hop.
    expect((reply?.content.length ?? 0)).toBeGreaterThan(1);
    expect(reply?.flowName).toContain("Specialist Assistant");
  });

  it("keeps only the acknowledgement when the handover target is unpublished (#314)", async () => {
    const { assistant } = await fixture();
    const target = await db.createAssistant(DEMO_ORG.id, {
      title: "Unpublished Assistant",
    });
    const handoverFlow = await db.createFlow(assistant.id, {
      name: "Route to specialist",
      description: "specialist topics",
      trigger: "message",
      actions: ["handover"],
      actionSettings: { handover: { assistantId: target.id } },
    });

    const events = await runTurn({
      assistant,
      flows: [handoverFlow],
      message: "I need the specialist",
    });
    const done = doneEvent(events);
    const messages = await db.listMessages(done.conversationId);
    const reply = messages.at(-1);
    expect(reply?.flowName).toBe("Route to specialist");
    expect(reply?.content).toHaveLength(1);
  });

  it("creates a conversation and persists both sides of the turn", async () => {
    const { assistant, flows } = await fixture();
    const events = await runTurn({ assistant, flows, message: "hi!" });

    const done = doneEvent(events);
    expect(done.messageId).not.toBeNull();
    expect(events.some((e) => e.type === "flow")).toBe(true);

    const conversation = await db.getConversation(done.conversationId);
    expect(conversation).toMatchObject({
      assistantId: assistant.id,
      subjectType: "visitor",
      subjectId: "visitor-1",
      title: "hi!",
    });

    const messages = await db.listMessages(done.conversationId);
    expect(messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(messages[1].flowName).toBeTruthy();
  });

  it("executes non-generative action effects without a provider connection", async () => {
    const { assistant } = await fixture();
    await db.createFlow(assistant.id, {
      name: "Refund request",
      description: "refund request",
      actions: ["improvement"],
    });
    const flows = await db.listFlows(assistant.id);
    const before = await db.listImprovements(DEMO_ORG.id);

    await runTurn({ assistant, flows, message: "I have a refund request" });

    const after = await db.listImprovements(DEMO_ORG.id);
    expect(after).toHaveLength(before.length + 1);
    expect(after[0]).toMatchObject({ title: "Review: I have a refund request" });
  });

  it("reuses the conversation when subject and assistant match", async () => {
    const { assistant, flows } = await fixture();
    const first = doneEvent(await runTurn({ assistant, flows }));
    const second = doneEvent(
      await runTurn({ assistant, flows, conversationId: first.conversationId })
    );
    expect(second.conversationId).toBe(first.conversationId);
    const messages = await db.listMessages(first.conversationId);
    expect(messages).toHaveLength(4);
  });

  it("loads only the recent bounded history for the model turn", async () => {
    const { assistant, flows } = await fixture();
    const first = doneEvent(await runTurn({ assistant, flows }));
    let requestedLimit: number | null = null;
    const boundedDb: Db = {
      ...db,
      async listRecentMessages(conversationId, limit) {
        requestedLimit = limit;
        return db.listRecentMessages(conversationId, limit);
      },
    };

    const stream = await streamConversationTurn({
      db: boundedDb,
      assistant,
      flows,
      connections: [],
      organizationId: DEMO_ORG.id,
      subjectType: "visitor",
      subjectId: "visitor-1",
      conversationId: first.conversationId,
      message: "continue",
      signal: new AbortController().signal,
    });
    await new Response(stream).text();

    expect(requestedLimit).toBe(RECENT_HISTORY_LIMIT);
  });

  it("starts a fresh conversation for a different subject (ownership guard)", async () => {
    const { assistant, flows } = await fixture();
    const first = doneEvent(await runTurn({ assistant, flows }));
    const hijack = doneEvent(
      await runTurn({
        assistant,
        flows,
        subjectId: "visitor-2",
        conversationId: first.conversationId,
      })
    );
    expect(hijack.conversationId).not.toBe(first.conversationId);
    // The original conversation gained no messages from the other subject.
    expect(await db.listMessages(first.conversationId)).toHaveLength(2);
  });

  it("starts a fresh conversation when the conversation belongs to another assistant", async () => {
    const a = await fixture();
    const b = await fixture();
    const first = doneEvent(await runTurn({ assistant: a.assistant, flows: a.flows }));
    const crossed = doneEvent(
      await runTurn({
        assistant: b.assistant,
        flows: b.flows,
        conversationId: first.conversationId,
      })
    );
    expect(crossed.conversationId).not.toBe(first.conversationId);
  });

  it("skips the usage ledger entirely on the no-model path", async () => {
    const { assistant, flows } = await fixture();
    let recordCalls = 0;
    const meteredDb: Db = {
      ...db,
      async recordAiUsage(rows) {
        recordCalls += 1;
        return db.recordAiUsage(rows);
      },
    };
    const stream = await streamConversationTurn({
      db: meteredDb,
      assistant,
      flows,
      connections: [],
      organizationId: DEMO_ORG.id,
      subjectType: "visitor",
      subjectId: "visitor-1",
      message: "hello",
      signal: new AbortController().signal,
    });
    await new Response(stream).text();
    // No model ran, so nothing was metered — and no empty-batch write happened.
    expect(recordCalls).toBe(0);
  });

  it("frames every event as one JSON object per line", async () => {
    const { assistant, flows } = await fixture();
    const stream = await streamConversationTurn({
      db,
      assistant,
      flows,
      connections: [],
      organizationId: DEMO_ORG.id,
      subjectType: "member",
      subjectId: "member-1",
      message: "ping",
      signal: new AbortController().signal,
    });
    const raw = await new Response(stream).text();
    expect(raw.endsWith("\n")).toBe(true);
    for (const line of raw.trim().split("\n")) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });
});

describe("chat_turn telemetry (ADR-0011)", () => {
  const captureDb = (captured: RuntimeEventInput[]): Db => ({
    ...db,
    async recordRuntimeEvent(event) {
      captured.push(event);
    },
  });

  it("records one succeeded chat_turn event for a completed turn", async () => {
    const { assistant, flows } = await fixture();
    const captured: RuntimeEventInput[] = [];
    const stream = await streamConversationTurn({
      db: captureDb(captured),
      assistant,
      flows,
      connections: [],
      organizationId: DEMO_ORG.id,
      subjectType: "visitor",
      subjectId: "visitor-1",
      message: "hello",
      signal: new AbortController().signal,
    });
    await new Response(stream).text();

    expect(captured).toHaveLength(1);
    expect(captured[0]).toMatchObject({
      organizationId: DEMO_ORG.id,
      assistantId: assistant.id,
      kind: "chat_turn",
      status: "succeeded",
      surface: "widget",
    });
    expect(captured[0].conversationId).toBeTruthy();
    expect(captured[0].durationMs ?? -1).toBeGreaterThanOrEqual(0);
  });

  it("attributes the preview surface when a preview key is resolved", async () => {
    const { assistant, flows } = await fixture();
    const captured: RuntimeEventInput[] = [];
    const stream = await streamConversationTurn({
      db: captureDb(captured),
      assistant,
      flows,
      connections: [],
      organizationId: DEMO_ORG.id,
      subjectType: "member",
      subjectId: "member-1",
      message: "ping",
      signal: new AbortController().signal,
      keyResolution: { surface: "preview", memberId: "member-1" },
    });
    await new Response(stream).text();
    expect(captured[0]?.surface).toBe("preview");
  });

  it("completes the turn even when the telemetry sink throws (fire-safe)", async () => {
    const { assistant, flows } = await fixture();
    const failingDb: Db = {
      ...db,
      async recordRuntimeEvent() {
        throw new Error("telemetry sink down");
      },
    };
    const stream = await streamConversationTurn({
      db: failingDb,
      assistant,
      flows,
      connections: [],
      organizationId: DEMO_ORG.id,
      subjectType: "visitor",
      subjectId: "visitor-1",
      message: "hello",
      signal: new AbortController().signal,
    });
    const events = (await new Response(stream).text())
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as RuntimeEvent);
    expect(events.at(-1)?.type).toBe("done");
  });

  it("records a failed chat_turn with an error class when the turn throws", async () => {
    const { assistant, flows } = await fixture();
    const captured: RuntimeEventInput[] = [];
    const brokenDb: Db = {
      ...db,
      async appendMessage(input) {
        if (input.role === "assistant") throw new TypeError("persist boom");
        return db.appendMessage(input);
      },
      async recordRuntimeEvent(event) {
        captured.push(event);
      },
    };
    const stream = await streamConversationTurn({
      db: brokenDb,
      assistant,
      flows,
      connections: [],
      organizationId: DEMO_ORG.id,
      subjectType: "visitor",
      subjectId: "visitor-err",
      message: "hello",
      signal: new AbortController().signal,
    });
    const events = (await new Response(stream).text())
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as RuntimeEvent);

    expect(events.at(-1)?.type).toBe("error");
    expect(captured).toHaveLength(1);
    expect(captured[0]).toMatchObject({
      kind: "chat_turn",
      status: "failed",
      errorClass: "TypeError",
    });
  });
});

describe("daily budget (notify mode)", () => {
  const budgetKey = `budget:${DEMO_ORG.id}`;
  const activeBudgetAlerts = async () =>
    (await db.listAlerts(DEMO_ORG.id)).filter(
      (a) => a.sourceKey === budgetKey && a.status === "active"
    );

  it("raises one refresh-while-active Alert over budget and keeps answering", async () => {
    const { assistant, flows } = await fixture();
    await db.setOrgBudget(DEMO_ORG.id, {
      dailyTokenLimit: 10,
      dailyEuroLimit: null,
      enforcement: "notify",
    });
    await db.recordAiUsage([
      {
        organizationId: DEMO_ORG.id,
        assistantId: assistant.id,
        stage: "generate",
        provider: "anthropic",
        modelId: "claude-opus-4-8",
        inputTokens: 50,
        outputTokens: 50,
      },
    ]);

    const first = await runTurn({ assistant, flows, message: "over budget?" });
    // Notify mode: the turn still completes normally.
    expect(doneEvent(first).messageId).not.toBeNull();
    expect(await activeBudgetAlerts()).toHaveLength(1);

    // A second over-budget turn refreshes the alert instead of duplicating it.
    await runTurn({ assistant, flows, message: "still over" });
    expect(await activeBudgetAlerts()).toHaveLength(1);
  });

  it("auto-resolves the Alert once the org is back under budget", async () => {
    const { assistant, flows } = await fixture();
    await db.setOrgBudget(DEMO_ORG.id, {
      dailyTokenLimit: 10_000_000,
      dailyEuroLimit: null,
      enforcement: "notify",
    });
    await runTurn({ assistant, flows, message: "back under" });
    expect(await activeBudgetAlerts()).toHaveLength(0);
  });

  it("block mode answers with neutral copy + escalation and persists the exchange", async () => {
    const { assistant, flows } = await fixture();
    await db.setOrgBudget(DEMO_ORG.id, {
      dailyTokenLimit: 10,
      dailyEuroLimit: null,
      enforcement: "block",
    });
    await db.recordAiUsage([
      {
        organizationId: DEMO_ORG.id,
        assistantId: assistant.id,
        stage: "generate",
        provider: "anthropic",
        modelId: "claude-opus-4-8",
        inputTokens: 100,
        outputTokens: 0,
      },
    ]);

    let recordCalls = 0;
    const meteredDb: Db = {
      ...db,
      async recordAiUsage(rows) {
        recordCalls += 1;
        return db.recordAiUsage(rows);
      },
    };
    const stream = await streamConversationTurn({
      db: meteredDb,
      assistant,
      flows,
      connections: [],
      organizationId: DEMO_ORG.id,
      subjectType: "visitor",
      subjectId: "visitor-blocked",
      message: "are you there?",
      signal: new AbortController().signal,
    });
    const events = (await new Response(stream).text())
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as RuntimeEvent);

    const done = doneEvent(events);
    expect(done.messageId).not.toBeNull();
    // No model ran and nothing was metered.
    expect(recordCalls).toBe(0);

    const messages = await db.listMessages(done.conversationId);
    expect(messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    const parts = messages[1].content as { type: string; text?: string }[];
    expect(parts.map((p) => p.type)).toEqual(["text", "help_desk"]);
    expect(parts[0].text).toContain("daily usage limit");

    // Reset for later tests.
    await db.setOrgBudget(DEMO_ORG.id, {
      dailyTokenLimit: null,
      dailyEuroLimit: null,
      enforcement: "notify",
    });
  });

  it("fails open when the budget read itself fails", async () => {
    const { assistant, flows } = await fixture();
    const failingDb: Db = {
      ...db,
      async getOrgBudget() {
        throw new Error("budget table unavailable");
      },
    };
    const stream = await streamConversationTurn({
      db: failingDb,
      assistant,
      flows,
      connections: [],
      organizationId: DEMO_ORG.id,
      subjectType: "visitor",
      subjectId: "visitor-1",
      message: "hello",
      signal: new AbortController().signal,
    });
    const text = await new Response(stream).text();
    const events = text
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as RuntimeEvent);
    expect(doneEvent(events).messageId).not.toBeNull();
  });
});

describe("readFlowTrustTier (new-flow watch semantics)", () => {
  it("maps a missing trust row to watch — trust is earned, not presumed", async () => {
    const assistant = await db.createAssistant(DEMO_ORG.id, {
      title: "No-history Fixture",
    });
    // No materialized row exists for this flow yet.
    expect(await readFlowTrustTier(db, assistant.id, "brand-new-flow")).toBe(
      "watch"
    );
  });

  it("a no-history flow's generative answer therefore offers human escalation", async () => {
    const assistant = await db.createAssistant(DEMO_ORG.id, {
      title: "No-history Escalation Fixture",
    });
    const tier = await readFlowTrustTier(db, assistant.id, "brand-new-flow");
    const parts: ChatReplyPart[] = [
      { type: "text", action: "search_knowledge", text: "a generated answer" },
    ];
    expect(needsWatchEscalation(parts, tier)).toBe(true);
  });

  it("returns the materialized tier when a row exists", async () => {
    const assistant = await db.createAssistant(DEMO_ORG.id, {
      title: "Measured Flow Fixture",
    });
    await db.upsertFlowTrust({
      assistantId: assistant.id,
      flowId: "measured",
      organizationId: DEMO_ORG.id,
      runs: 20,
      passes: 20,
      tier: "auto",
    });
    expect(await readFlowTrustTier(db, assistant.id, "measured")).toBe("auto");
  });

  it("stays fail-open (null) on a read error — absence-of-history must not out-trust a measured flow", async () => {
    const failing: Db = {
      ...db,
      async getFlowTrust() {
        throw new Error("trust table unavailable");
      },
    };
    expect(await readFlowTrustTier(failing, "a", "f")).toBeNull();
  });
});

describe("recordProviderHealth", () => {
  it("raises, deduplicates, and auto-resolves federated provider alerts", async () => {
    await recordProviderHealth({
      db,
      organizationId: DEMO_ORG.id,
      assistantTitle: "Campus AI",
      event: {
        provider: "google",
        credentialKind: "google_vertex_federated",
        ok: false,
        detail: "invalid_grant",
      },
    });
    await recordProviderHealth({
      db,
      organizationId: DEMO_ORG.id,
      assistantTitle: "Campus AI",
      event: {
        provider: "google",
        credentialKind: "google_vertex_federated",
        ok: false,
        detail: "quota exceeded",
      },
    });

    const sourceKey = "provider:google:google_vertex_federated";
    const active = (await db.listAlerts(DEMO_ORG.id)).filter(
      (a) => a.sourceKey === sourceKey && a.status === "active"
    );
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({
      type: "provider",
      title: "Google Vertex federated auth failed",
    });
    expect(active[0].detail).toContain("quota exceeded");

    await recordProviderHealth({
      db,
      organizationId: DEMO_ORG.id,
      assistantTitle: "Campus AI",
      event: {
        provider: "google",
        credentialKind: "google_vertex_federated",
        ok: true,
      },
    });
    const after = (await db.listAlerts(DEMO_ORG.id)).filter(
      (a) => a.sourceKey === sourceKey && a.status === "active"
    );
    expect(after).toHaveLength(0);
  });
});

/**
 * Ticket #328: every successful terminal path — normal completion, FAQ quick
 * reply, budget block — ends in the same finishTurn ritual, so all three must
 * record the same succeeded chat_turn telemetry contract (org/assistant ids,
 * messageId, flowName, duration).
 */
describe("finishTurn telemetry consistency (#328)", () => {
  const captureDb = (captured: RuntimeEventInput[]): Db => ({
    ...db,
    async recordRuntimeEvent(event) {
      captured.push(event);
    },
  });

  async function capturedTurn(input: {
    assistant: Assistant;
    flows: Flow[];
    message: string;
    faqQuestion?: boolean;
  }): Promise<RuntimeEventInput> {
    const captured: RuntimeEventInput[] = [];
    const stream = await streamConversationTurn({
      db: captureDb(captured),
      assistant: input.assistant,
      flows: input.flows,
      connections: [],
      organizationId: DEMO_ORG.id,
      subjectType: "visitor",
      subjectId: "visitor-1",
      message: input.message,
      faqQuestion: input.faqQuestion,
      signal: new AbortController().signal,
    });
    await new Response(stream).text();
    expect(captured).toHaveLength(1);
    return captured[0];
  }

  function expectSucceededContract(event: RuntimeEventInput, flowName: string) {
    expect(event).toMatchObject({
      organizationId: DEMO_ORG.id,
      kind: "chat_turn",
      status: "succeeded",
      surface: "widget",
      flowName,
    });
    expect(event.messageId).toBeTruthy();
    expect(event.durationMs ?? -1).toBeGreaterThanOrEqual(0);
  }

  it("the FAQ quick-reply path records the shared succeeded contract", async () => {
    const { assistant, flows } = await fixture();
    const collection = await db.createCollection(assistant.id, {
      name: "FAQ Collection",
    });
    await db.createConcept({
      collectionId: collection.id,
      sourceId: null,
      path: "faq/telemetry.md",
      frontmatter: { type: "FAQ", title: "Is telemetry recorded?" },
      body: "Yes, one chat_turn per turn.",
    });
    const event = await capturedTurn({
      assistant,
      flows,
      message: "Is telemetry recorded?",
      faqQuestion: true,
    });
    expectSucceededContract(event, "FAQ");
  });

  it("the budget-block path records the shared succeeded contract", async () => {
    const { assistant, flows } = await fixture();
    await db.setOrgBudget(DEMO_ORG.id, {
      dailyTokenLimit: 1,
      dailyEuroLimit: null,
      enforcement: "block",
    });
    await db.recordAiUsage([
      {
        organizationId: DEMO_ORG.id,
        assistantId: assistant.id,
        stage: "generate",
        provider: "anthropic",
        modelId: "claude-opus-4-8",
        inputTokens: 50,
        outputTokens: 50,
      },
    ]);
    try {
      const event = await capturedTurn({
        assistant,
        flows,
        message: "blocked?",
      });
      expectSucceededContract(event, "Budget limit");
    } finally {
      await db.setOrgBudget(DEMO_ORG.id, {
        dailyTokenLimit: null,
        dailyEuroLimit: null,
        enforcement: "notify",
      });
    }
  });

  it("the normal-completion path records the shared succeeded contract", async () => {
    const { assistant, flows } = await fixture();
    const event = await capturedTurn({
      assistant,
      flows,
      message: "hello there",
    });
    expectSucceededContract(event, event.flowName ?? "");
    expect(event.flowName).toBeTruthy();
  });
});

describe("plan-cap gate (#442)", () => {
  // The mock assistant's provider is google; setting its platform env key
  // makes turnConnectionKind resolve a platform-funded credential without
  // any network call (the gate blocks before the engine ever runs).
  const PLATFORM_KEY = "GOOGLE_GENERATIVE_AI_API_KEY";

  afterEach(() => {
    resetEnterpriseCapabilities();
    delete process.env[PLATFORM_KEY];
  });

  it("turnConnectionKind is null with no credentials (deterministic path)", async () => {
    const { assistant } = await fixture();
    expect(turnConnectionKind(assistant, [])).toBeNull();
  });

  it("turnConnectionKind maps a platform env key to 'platform'", async () => {
    const { assistant } = await fixture();
    process.env[PLATFORM_KEY] = "test-platform-key";
    expect(turnConnectionKind(assistant, [])).toBe("platform");
  });

  it("a blocking enforcement pauses a platform-funded turn with a graceful reply", async () => {
    const { assistant, flows } = await fixture();
    process.env[PLATFORM_KEY] = "test-platform-key";
    registerEnterpriseCapabilities({
      metering: {
        checkUsage: async ({ connectionKind }) => {
          expect(connectionKind).toBe("platform");
          return { outcome: "block", message: "Included usage exhausted." };
        },
      },
    });

    const events = await runTurn({ assistant, flows, message: "hello" });
    const flowEvent = events.find((e) => e.type === "flow");
    expect(flowEvent).toMatchObject({ flowName: "Usage limit" });
    const parts = events
      .filter((e) => e.type === "part")
      .map((e) => (e as { part: ChatReplyPart }).part);
    expect(parts[0]).toMatchObject({
      type: "text",
      text: "Included usage exhausted.",
    });
    expect(parts[1]).toMatchObject({ type: "help_desk" });
    // The exchange persists like any turn — the visitor is never dropped.
    const done = doneEvent(events);
    expect(done.messageId).toBeTruthy();
  });

  it("a pending organization runs no turn at all — not even on its own key", async () => {
    // Managed onboarding (#444): a fresh signup can build everything, but its
    // assistants stay silent until staff activate it. Unlike the usage cap
    // this applies to bring-your-own-key traffic too, because a pending
    // organization is not yet a customer.
    const { assistant, flows } = await fixture();
    const metering = { called: false };
    registerEnterpriseCapabilities({
      activation: {
        getActivation: async () => ({
          state: "pending",
          visitorMessage: "This assistant isn’t available yet.",
        }),
      },
      metering: {
        checkUsage: async () => {
          metering.called = true;
          return { outcome: "allow" };
        },
      },
    });

    const events = await runTurn({ assistant, flows, message: "hello" });

    expect(events.find((e) => e.type === "flow")).toMatchObject({
      flowName: "Pending activation",
    });
    const parts = events
      .filter((e) => e.type === "part")
      .map((e) => (e as { part: ChatReplyPart }).part);
    expect(parts[0]).toMatchObject({
      type: "text",
      text: "This assistant isn’t available yet.",
    });
    // The visitor still gets a way to reach a human, and the exchange is
    // persisted like any other turn.
    expect(parts[1]).toMatchObject({ type: "help_desk" });
    expect(doneEvent(events).messageId).toBeTruthy();
    // No credential was even considered: the org has no funded traffic yet.
    expect(metering.called).toBe(false);
  });

  it("the OSS default lets every organization answer — self-hosting is never gated", async () => {
    // The whole open-core boundary rests on this: with no enterprise
    // registration, activation is unconditionally active.
    const { assistant, flows } = await fixture();
    const events = await runTurn({ assistant, flows, message: "hello" });
    expect(events.find((e) => e.type === "flow")).not.toMatchObject({
      flowName: "Pending activation",
    });
    doneEvent(events);
  });

  it("only a block interrupts the turn — the no-credential path never even asks", async () => {
    const { assistant, flows } = await fixture();
    // Deliberately offline: no credentials resolve → connectionKind null →
    // checkUsage is never called, proving the deterministic path is exempt
    // from the gate. (Warn-through-the-gate — outcome "warn" leaves the turn
    // untouched — is covered at the unit level in ee/metering.test.ts; a
    // warn turn here would need a live model call.)
    const checkUsage = { called: false };
    registerEnterpriseCapabilities({
      metering: {
        checkUsage: async () => {
          checkUsage.called = true;
          return { outcome: "warn", usedFraction: 0.9 };
        },
      },
    });
    const events = await runTurn({ assistant, flows, message: "hello there" });
    expect(checkUsage.called).toBe(false);
    expect(events.find((e) => e.type === "flow")).not.toMatchObject({
      flowName: "Usage limit",
    });
    doneEvent(events);
  });
});
