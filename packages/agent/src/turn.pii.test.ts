import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LanguageModelV4CallOptions, LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { defaultGuardrail, type Assistant, type AssistantGuardrail, type Flow } from "@agent-hub/core";
import { DEMO_ORG, getMockDb } from "@agent-hub/db";
import { registerRuntimeHost, resetRuntimeHost } from "./host";
import { streamConversationTurn } from "./turn";
import type { RuntimeEvent } from "./types";

/**
 * The PII masking guarantee (#1078), asserted where it is made: no request a
 * Conversation Turn sends to a model provider carries a value the Visitor
 * typed. The provider SDK is replaced at its factory, so every language model
 * still goes through `buildModel` and its middleware exactly as in production,
 * and the moderation request is caught at `fetch`. Whatever the turn sends, to
 * whichever of them, is recorded here and searched for the raw values.
 */

/** Every request a provider received, tagged with what kind of call it was. */
const sent = vi.hoisted(() => ({
  requests: [] as { kind: string; body: string }[],
  /** What the write phase answers; a test may swap it. */
  answer: [] as string[],
}));
const DEFAULT_ANSWER = ["Thanks! I will write to [EMA", "IL_1] and call [PHONE_", "1] today."];

vi.mock("@ai-sdk/openai", async () => {
  const { MockEmbeddingModelV4, MockLanguageModelV4 } = await import("ai/test");
  const { simulateReadableStream } = await import("ai");
  const usage = {
    inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
    outputTokens: { total: 1, text: 1, reasoning: undefined },
  };
  const finish = (unified: "stop" | "tool-calls") =>
    ({ type: "finish" as const, finishReason: { unified, raw: unified }, usage });
  const text = (deltas: string[]): LanguageModelV4StreamPart[] => [
    { type: "text-start" as const, id: "1" },
    ...deltas.map((delta) => ({ type: "text-delta" as const, id: "1", delta })),
    { type: "text-end" as const, id: "1" },
    finish("stop"),
  ];
  const call = (toolName: string, input: object): LanguageModelV4StreamPart[] => [
    { type: "tool-call" as const, toolCallId: `${toolName}-1`, toolName, input: JSON.stringify(input) },
    finish("tool-calls"),
  ];
  // The model plays each part of a Search knowledge turn: routing asks for
  // JSON and hears "nothing matched"; the gather phase searches for the
  // Visitor's email by its placeholder and then declares it can answer; the
  // write phase answers with both placeholders, one split mid-token.
  const language = () =>
    new MockLanguageModelV4({
      doStream: async (options: LanguageModelV4CallOptions) => {
        const tools = (options.tools ?? []).map((t) => t.name);
        const searched = options.prompt.some((m) => m.role === "tool");
        const kind =
          options.responseFormat?.type === "json" ? "routing" : tools.length > 0 ? "gather" : "answer";
        sent.requests.push({ kind, body: JSON.stringify(options.prompt) });
        const chunks =
          kind === "routing"
            ? text(['{"intent":"Asks to be called back on [PHONE_1].","matchingFlowIds":[]}'])
            : kind === "gather" && !searched && tools.includes("searchKnowledge")
              ? call("searchKnowledge", { queries: ["refund for [EMAIL_1]"] })
              : kind === "gather"
                ? call("readyToAnswer", { status: "answer" })
                : text(sent.answer);
        return { stream: simulateReadableStream({ chunks }) };
      },
      // Decisions (the topic check, the pre-flight) take the adapter path.
      doGenerate: async (options: LanguageModelV4CallOptions) => {
        sent.requests.push({ kind: "decision", body: JSON.stringify(options.prompt) });
        return {
          content: [{ type: "text" as const, text: "{}" }],
          finishReason: { unified: "stop" as const, raw: "stop" },
          usage,
          warnings: [],
        };
      },
    });
  const embedding = () =>
    new MockEmbeddingModelV4({
      doEmbed: async ({ values }: { values: string[] }) => {
        sent.requests.push({ kind: "embedding", body: JSON.stringify(values) });
        return { embeddings: values.map(() => [0.1, 0.2, 0.3]), warnings: [] };
      },
    });
  return {
    createOpenAI: () => Object.assign(() => language(), { embedding, chat: language, responses: language }),
  };
});

const db = getMockDb();
const EMAIL = "jane.doe@example.com";
const PHONE = "+39 06 1234 5678";
const CARD = "4111 1111 1111 1111";

const ofType = <T extends AssistantGuardrail["type"]>(type: T, id: string) =>
  defaultGuardrail(type, id) as Extract<AssistantGuardrail, { type: T }>;

const guardrails: AssistantGuardrail[] = [
  ofType("pii_masking", "pii"),
  // `log`, so a check the fake provider cannot answer never ends the turn.
  { ...ofType("moderation", "mod"), action: "log" },
  { ...ofType("restrict_to_topic", "topic"), action: "log", topics: ["Orders"] },
];

async function fixture(): Promise<{ assistant: Assistant; flows: Flow[] }> {
  const created = await db.createAssistant(DEMO_ORG.id, { title: "Masking Assistant" });
  const assistant: Assistant = { ...created, modelProvider: "openai", modelId: "gpt-5.4-mini", guardrails };
  // A second Flow so routing has a choice to make. The Default behavior
  // searches knowledge, as it ships.
  await db.createFlow(created.id, { name: "Refunds", description: "asks for a refund", actions: ["custom_message"] });
  return { assistant, flows: await db.listFlows(created.id) };
}

async function turn(
  fixed: { assistant: Assistant; flows: Flow[] },
  message: string,
  conversationId: string | null = null
): Promise<RuntimeEvent[]> {
  const stream = await streamConversationTurn({
    db,
    ...fixed,
    connections: [],
    organizationId: DEMO_ORG.id,
    // An SSO subject with long-term memory on, so the first turn also embeds
    // the message to recall memories.
    subjectType: "sso",
    subjectId: "sso-jane",
    verifiedIdentity: { subjectId: "sso-jane" },
    conversationId,
    message,
    signal: new AbortController().signal,
  });
  return (await new Response(stream).text())
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as RuntimeEvent);
}

const bodies = () => sent.requests.map((r) => r.body).join("\n");
const kinds = () => new Set(sent.requests.map((r) => r.kind));

beforeEach(async () => {
  sent.requests.length = 0;
  sent.answer = DEFAULT_ANSWER;
  // The pre-flight is one more decision on the Visitor's message.
  registerRuntimeHost({ preflightShadowEnabled: () => true });
  vi.stubEnv("OPENAI_API_KEY", "sk-test-platform");
  vi.stubEnv("AI_GATEWAY_API_KEY", undefined);
  vi.stubEnv("TYPESAFE_AI_API_KEY", undefined);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: unknown, init?: RequestInit) => {
      sent.requests.push({ kind: "moderation", body: String(init?.body ?? "") });
      return new Response(JSON.stringify({ results: [{ flagged: false, categories: {} }] }), {
        headers: { "content-type": "application/json" },
      });
    })
  );
  await db.setMemoryEnabled(DEMO_ORG.id, true);
});

afterEach(() => {
  resetRuntimeHost();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("a turn with PII masking on", () => {
  it("sends no raw value to any provider, and answers with the real ones", async () => {
    const fixed = await fixture();
    const message = `Please call me on ${PHONE} or mail ${EMAIL}. Card ${CARD}.`;
    const events = await turn(fixed, message);
    const done = events.at(-1);
    expect(done?.type).toBe("done");

    // Every kind of call the turn makes was made, so a path that silently
    // stopped running fails here rather than passing with nothing to check.
    expect(kinds()).toEqual(
      new Set(["moderation", "decision", "embedding", "routing", "gather", "answer"])
    );
    // And none of them saw a value.
    const sentToProviders = bodies();
    for (const value of [EMAIL, PHONE, CARD, "4111111111111111"]) {
      expect(sentToProviders).not.toContain(value);
    }
    expect(sentToProviders).toContain("[EMAIL_1]");
    expect(sentToProviders).toContain("[PHONE_1]");
    expect(sentToProviders).toContain("[CARD_1]");
    // The search tool ran with the real address (the Organization's own
    // index), and its query embedding went out masked again.
    const embeddings = sent.requests.filter((r) => r.kind === "embedding").map((r) => r.body);
    expect(embeddings).toContain(JSON.stringify(["refund for [EMAIL_1]"]));

    // The Visitor reads their own values, and no streamed delta carried a
    // placeholder or a fragment of one.
    const streamed = events.flatMap((e) => (e.type === "text-delta" ? [e.delta] : [])).join("");
    expect(streamed).toBe(`Thanks! I will write to ${EMAIL} and call ${PHONE} today.`);

    // The transcript keeps what was typed and what was read.
    const conversationId = (done as { conversationId: string }).conversationId;
    const [user, reply] = await db.listMessages(conversationId);
    expect(JSON.stringify(user!.content)).toContain(EMAIL);
    expect(JSON.stringify(reply!.content)).toContain(`write to ${EMAIL} and call ${PHONE}`);
    expect(JSON.stringify(reply!.content)).not.toContain("[EMAIL_1]");

    // The trace counts what was masked, and holds no value and no map.
    expect(reply!.trace?.piiMasking).toEqual({
      id: "pii",
      name: "PII masking",
      masked: [
        { detector: "email", origin: "visitor", count: 1 },
        { detector: "phone", origin: "visitor", count: 1 },
        { detector: "payment_card", origin: "visitor", count: 1 },
      ],
    });
    const entry = JSON.stringify(reply!.trace?.piiMasking);
    for (const value of [EMAIL, PHONE, "[EMAIL_1]", "[PHONE_1]"]) expect(entry).not.toContain(value);
    // The routing narration is the model's text too, restored like the answer:
    // the Thinking panel shows the Visitor their own number, not a placeholder.
    expect(JSON.stringify(reply!.trace?.steps)).toContain(`called back on ${PHONE}`);
  });

  it("masks the history a later turn sends, with the same placeholders", async () => {
    const fixed = await fixture();
    const first = await turn(fixed, `I am ${EMAIL}`);
    const conversationId = (first.at(-1) as { conversationId: string }).conversationId;
    sent.requests.length = 0;

    await turn(fixed, `And my phone is ${PHONE}`, conversationId);
    const sentToProviders = bodies();
    // The earlier message and the answer that repeated the value back.
    expect(sentToProviders).not.toContain(EMAIL);
    expect(sentToProviders).not.toContain(PHONE);
    expect(sentToProviders).toContain("I am [EMAIL_1]");
  });

  it("changes nothing when the guardrail is off", async () => {
    const fixed = await fixture();
    const off = { ...fixed, assistant: { ...fixed.assistant, guardrails: guardrails.slice(1) } };
    await turn(off, `I am ${EMAIL}`);
    expect(bodies()).toContain(EMAIL);
  });

  /** A turn whose knowledge search finds one passage naming refunds@example.org. */
  async function turnWithPassage(message: string) {
    const fixed = await fixture();
    const passage = {
      conceptId: "concept-refunds",
      conceptTitle: "Refunds: write to refunds@example.org",
      conceptPath: "refunds.md",
      collectionId: "col-1",
      collectionName: "Policies",
      sourceName: "policy.pdf",
      sourceId: "src-1",
      directAccess: false,
      resourceUrl: null,
      content: "Refund requests go to refunds@example.org within 30 days.",
      similarity: 0.9,
    };
    // The demo store has no such passage; this Db finds it for any query.
    const withPassage = Object.assign(Object.create(db) as typeof db, {
      searchChunks: async () => [passage],
    });
    const stream = await streamConversationTurn({
      db: withPassage,
      ...fixed,
      connections: [],
      organizationId: DEMO_ORG.id,
      subjectType: "visitor",
      subjectId: `visitor-${crypto.randomUUID()}`,
      message,
      signal: new AbortController().signal,
    });
    const events = (await new Response(stream).text())
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as RuntimeEvent);
    const done = events.at(-1) as { type: string; conversationId: string };
    expect(done.type).toBe("done");
    const [, reply] = await db.listMessages(done.conversationId);
    return reply!;
  }

  it("masks a retrieved passage, answers with its value, and cites the original (#1079)", async () => {
    sent.answer = ["Send it to [EMAIL_", "2] within 30 days."];
    const reply = await turnWithPassage(`How do I get a refund? I am ${EMAIL}`);

    // The passage reached the gather step masked, with the Visitor's value
    // and the Source's value as two placeholders of one map.
    const sentToProviders = bodies();
    expect(sentToProviders).not.toContain("refunds@example.org");
    expect(sentToProviders).not.toContain(EMAIL);
    expect(sentToProviders).toContain("go to [EMAIL_2] within");

    const content = JSON.stringify(reply.content);
    expect(content).toContain("Send it to refunds@example.org within 30 days.");
    // The Sources disclosure shows the Source as it is written.
    const sources = reply.content.find((part) => (part as { type: string }).type === "sources");
    expect(JSON.stringify(sources)).toContain("Refunds: write to refunds@example.org");
    expect(content).not.toMatch(/\[EMAIL_\d+\]/);

    expect(reply.trace?.piiMasking?.masked).toEqual([
      { detector: "email", origin: "visitor", count: 1 },
      { detector: "email", origin: "knowledge", count: 1 },
    ]);
  });

  it("gives a value the Visitor typed and the same value in a Source one placeholder (#1079)", async () => {
    sent.answer = ["Yes, write to [EMAIL_1]."];
    const reply = await turnWithPassage("Is refunds@example.org the right address?");
    const sentToProviders = bodies();
    expect(sentToProviders).toContain("Is [EMAIL_1] the right address?");
    expect(sentToProviders).toContain("go to [EMAIL_1] within");
    expect(sentToProviders).not.toContain("[EMAIL_2]");
    expect(JSON.stringify(reply.content)).toContain("Yes, write to refunds@example.org.");
    // Counted once, as what the Visitor typed: they said it first.
    expect(reply.trace?.piiMasking?.masked).toEqual([{ detector: "email", origin: "visitor", count: 1 }]);
  });
});
