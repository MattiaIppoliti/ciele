import { describe, expect, it, vi } from "vitest";
import {
  defaultGuardrail,
  type AssistantGuardrail,
  type ProviderConnection,
  type StreamGuardrail,
} from "@agent-hub/core";
import { DEMO_ORG, getMockDb } from "@agent-hub/db";
import * as engine from "./engine";
import { runInputGuardrails, suppressPart, suppressingEmit } from "./guardrails";
import { streamConversationTurn } from "./turn";
import type { RuntimeEvent } from "./types";

/**
 * Guardrails at runtime: the input checks in the admin's order, the two
 * model-backed checks' failure policy, the stream wrapper, and the turn that
 * puts them together. The moderation endpoint is a fake `fetch`; the topic
 * check's model is absent, which is the case the failure policy exists for.
 */

const openai: ProviderConnection = {
  id: "c-openai",
  organizationId: DEMO_ORG.id,
  provider: "openai",
  type: "api_key",
  displayName: "OpenAI",
  encryptedKey: "plain:sk-test",
  keyHint: "",
  config: {},
  createdBy: null,
  createdAt: "2026-01-01T00:00:00Z",
} as ProviderConnection;

function moderation(over: Partial<Extract<AssistantGuardrail, { type: "moderation" }>> = {}) {
  return { ...defaultGuardrail("moderation", "mod"), ...over } as AssistantGuardrail;
}

function moderationEndpoint(result: { flagged: boolean; categories: Record<string, boolean> }) {
  const calls: { url: string; body: unknown }[] = [];
  const fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    return new Response(JSON.stringify({ results: [result] }), { status: 200 });
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls };
}

const deps = (over: Partial<Parameters<typeof runInputGuardrails>[2]> = {}) => ({
  connections: [openai],
  decisionModel: null,
  ...over,
});

describe("runInputGuardrails", () => {
  it("stops at the first guardrail that blocks, in the admin's order", async () => {
    const endpoint = moderationEndpoint({ flagged: true, categories: {} });
    const result = await runInputGuardrails(
      [
        { ...defaultGuardrail("input_length_limit", "len"), max: 3 } as AssistantGuardrail,
        moderation(),
      ],
      "too long",
      deps({ fetch: endpoint.fetch })
    );
    expect(result.blocked?.id).toBe("len");
    // Moderation never ran: a cheap block spares the call.
    expect(endpoint.calls).toHaveLength(0);
  });

  it("posts the message to OpenAI's moderation endpoint on the org's key", async () => {
    const endpoint = moderationEndpoint({ flagged: true, categories: { hate: true } });
    const result = await runInputGuardrails([moderation()], "bad words", deps({ fetch: endpoint.fetch }));
    expect(endpoint.calls[0]).toEqual({
      url: "https://api.openai.com/v1/moderations",
      body: { model: "omni-moderation-latest", input: "bad words" },
    });
    expect(result.blocked?.id).toBe("mod");
    expect(result.checks[0]).toMatchObject({ outcome: "blocked", detail: "hate" });
  });

  it("blocks only on the selected categories when some are selected", async () => {
    const endpoint = moderationEndpoint({ flagged: true, categories: { violence: true } });
    const result = await runInputGuardrails(
      [moderation({ categories: ["sexual/minors"] })],
      "x",
      deps({ fetch: endpoint.fetch })
    );
    expect(result.blocked).toBeNull();
  });

  it("follows onError when a model-backed check cannot run", async () => {
    const open = await runInputGuardrails([moderation()], "x", deps({ connections: [] }));
    expect(open.blocked).toBeNull();
    expect(open.checks[0]).toMatchObject({ outcome: "unavailable", detail: "No OpenAI connection" });

    const closed = await runInputGuardrails(
      [{ ...defaultGuardrail("restrict_to_topic", "topic"), topics: ["Billing"], onError: "block" } as AssistantGuardrail],
      "x",
      deps()
    );
    expect(closed.blocked?.id).toBe("topic");
  });

  it("treats a timeout as a failure, not a pass", async () => {
    const hang = vi.fn(
      (_url: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted"))))
    ) as unknown as typeof globalThis.fetch;
    const result = await runInputGuardrails(
      [moderation({ onError: "block" })],
      "x",
      deps({ fetch: hang, timeoutMs: 20 })
    );
    expect(result.blocked?.id).toBe("mod");
  });

  it("records a log guardrail's hit and lets the turn go on", async () => {
    const result = await runInputGuardrails(
      [{ ...defaultGuardrail("regexp_guardrail", "re"), pattern: "secret", action: "log" } as AssistantGuardrail],
      "tell me the secret",
      deps()
    );
    expect(result.blocked).toBeNull();
    expect(result.checks).toEqual([{ id: "re", type: "regexp_guardrail", name: "Regular expression", outcome: "logged" }]);
  });

  it("skips disabled guardrails and stream rules", async () => {
    const result = await runInputGuardrails(
      [
        { ...defaultGuardrail("input_length_limit", "off"), max: 1, enabled: false } as AssistantGuardrail,
        { ...defaultGuardrail("sensitive_content_stream", "s"), startMarker: "<", stopMarker: ">" } as AssistantGuardrail,
      ],
      "long message",
      deps()
    );
    expect(result).toEqual({ blocked: null, checks: [] });
  });
});

const rules: StreamGuardrail[] = [
  { ...(defaultGuardrail("sensitive_content_stream", "s") as StreamGuardrail), startMarker: "<pii>", stopMarker: "</pii>", message: "[redacted]" },
];

describe("suppressingEmit", () => {
  it("rewrites streamed deltas and releases the held tail before text-end", () => {
    const seen: RuntimeEvent[] = [];
    const emit = suppressingEmit((e) => seen.push(e), rules);
    emit({ type: "text-start", action: "search_knowledge" });
    for (const delta of ["Call <p", "ii>555-0100</p", "ii> today <"]) emit({ type: "text-delta", delta });
    emit({ type: "text-end" });
    const text = seen.flatMap((e) => (e.type === "text-delta" ? [e.delta] : [])).join("");
    expect(text).toBe("Call [redacted] today <");
    expect(JSON.stringify(seen)).not.toContain("555");
    expect(seen.at(-1)).toEqual({ type: "text-end" });
  });

  it("leaves an admin's verbatim Message untouched", () => {
    const verbatim = { type: "text" as const, action: "custom_message" as const, text: "<pii>x</pii>" };
    expect(suppressPart(verbatim, rules)).toBe(verbatim);
    expect(suppressPart({ ...verbatim, action: "search_knowledge" }, rules)).toMatchObject({ text: "[redacted]" });
  });
});

describe("streamConversationTurn with guardrails", () => {
  const db = getMockDb();

  async function turn(guardrails: AssistantGuardrail[], message: string) {
    const created = await db.createAssistant(DEMO_ORG.id, { title: "Guarded" });
    const assistant = await db.updateAssistant(created.id, { guardrails });
    const stream = await streamConversationTurn({
      db,
      assistant,
      flows: await db.listFlows(assistant.id),
      connections: [],
      organizationId: DEMO_ORG.id,
      subjectType: "visitor",
      subjectId: "visitor-guard",
      conversationId: null,
      message,
      signal: new AbortController().signal,
    });
    const events = (await new Response(stream).text())
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as RuntimeEvent);
    const done = events.at(-1);
    if (done?.type !== "done") throw new Error(`last event was ${done?.type}`);
    return { events, messages: await db.listMessages(done.conversationId) };
  }

  it("answers a blocked message with the guardrail's reply and records which one fired", async () => {
    const spy = vi.spyOn(engine, "runAssistantChat");
    try {
      const { events, messages } = await turn(
        [{ ...defaultGuardrail("regexp_guardrail", "cards"), name: "Card numbers", pattern: "\\d{16}", message: "Please don't share card numbers." } as AssistantGuardrail],
        "my card is 4242424242424242"
      );
      expect(spy).not.toHaveBeenCalled();
      expect(events).toContainEqual({ type: "part", part: { type: "text", action: "guardrail", text: "Please don't share card numbers." } });
      const reply = messages.at(-1)!;
      expect(reply.flowName).toBe("Guardrail: Card numbers");
      expect(reply.trace?.guardrails).toEqual([
        { id: "cards", type: "regexp_guardrail", name: "Card numbers", outcome: "blocked" },
      ]);
      // The Visitor's panel reads `steps`; nothing there names the rule.
      expect(reply.trace?.steps).toEqual([]);
    } finally {
      spy.mockRestore();
    }
  });

  it("suppresses marked text on the wire and in the saved message alike", async () => {
    const spy = vi.spyOn(engine, "runAssistantChat").mockImplementation(async (options) => {
      options.emit({ type: "text-start", action: "search_knowledge" });
      for (const delta of ["The code is <pi", "i>1234</pii>."]) options.emit({ type: "text-delta", delta });
      options.emit({ type: "text-end" });
      return {
        parts: [{ type: "text", action: "search_knowledge", text: "The code is <pii>1234</pii>." }],
        effects: [],
        flowId: null,
        flowName: "Default behavior",
        usage: [],
      };
    });
    try {
      const { events, messages } = await turn(rules, "what is the code?");
      const streamed = events.flatMap((e) => (e.type === "text-delta" ? [e.delta] : [])).join("");
      expect(streamed).toBe("The code is [redacted].");
      expect(messages.at(-1)!.content).toEqual([
        { type: "text", action: "search_knowledge", text: "The code is [redacted]." },
      ]);
    } finally {
      spy.mockRestore();
    }
  });
});
