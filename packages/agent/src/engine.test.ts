import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Assistant, Flow } from "@agent-hub/core";
import { MockLanguageModelV3 } from "ai/test";
import { classifyIntent, flowCatalogEntry, runAssistantChat } from "./engine";
import { createTurnSession } from "./session";
import type { ActionContext, RuntimeEvent } from "./types";

// Dispatch-semantics tests drive the shared action loop through controlled
// handlers; contactLabel stays trivial (only the watch-escalation path uses it).
const mocked = vi.hoisted(() => ({
  handlers: {} as Record<
    string,
    (ctx: ActionContext) => Promise<{
      parts: { type: "text"; action: string; text: string }[];
      effects?: unknown[];
      templatePatch?: Record<string, unknown>;
      handoverTo?: string;
      halt?: boolean;
    }>
  >,
}));
vi.mock("./actions", () => ({
  ACTION_HANDLERS: new Proxy(
    {},
    { get: (_t, action: string) => mocked.handlers[action] }
  ),
  contactLabel: () => "Contact support",
}));

/**
 * Intent Classification, tested through its interface (context.md: the router
 * is authoritative — the classifier picks *which* flow, never *what* it does).
 * The mock model runs the real generateObject pipeline offline, so the
 * schema-parse path and the classify → matchFlow → Default fallback chain are
 * exercised exactly as in production.
 */

function makeFlow(overrides: Partial<Flow> = {}): Flow {
  return {
    id: "flow-1",
    assistantId: "assistant-1",
    name: "Test flow",
    description: "",
    builtIn: false,
    enabled: true,
    position: 0,
    trigger: "message",
    conditionLogic: "any",
    conditions: [],
    actions: [],
    actionSettings: {},
    customMessage: "",
    isDefault: false,
    ...overrides,
  };
}

const defaultFlow = makeFlow({
  id: "default",
  name: "Default behavior",
  isDefault: true,
  actions: ["search_knowledge"],
});

function pickerModel(...matchingFlowIds: string[]) {
  return new MockLanguageModelV3({
    doGenerate: {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ matchingFlowIds }),
        },
      ],
      finishReason: { unified: "stop" as const, raw: "stop" },
      usage: {
        inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
        outputTokens: { total: 1, text: 1, reasoning: undefined },
      },
      warnings: [],
    },
  });
}

describe("classifyIntent", () => {
  const examFlow = makeFlow({
    id: "exams",
    name: "Exam dates",
    description: "questions about exam schedules",
  });

  it("returns the flow the classifier picks", async () => {
    const flow = await classifyIntent(
      "when is the marketing exam?",
      [examFlow, defaultFlow],
      pickerModel("exams")
    );
    expect(flow?.id).toBe("exams");
  });

  it('falls back to the Default behavior when the classifier answers "default"', async () => {
    const flow = await classifyIntent(
      "unrelated question",
      [examFlow, defaultFlow],
      pickerModel()
    );
    expect(flow?.id).toBe("default");
  });

  it("falls back to the Default behavior on an unknown flow id", async () => {
    const flow = await classifyIntent(
      "hello",
      [examFlow, defaultFlow],
      pickerModel("no-such-flow")
    );
    expect(flow?.id).toBe("default");
  });

  it("trims whitespace around returned flow ids", async () => {
    const flow = await classifyIntent(
      "when is the exam?",
      [examFlow, defaultFlow],
      pickerModel("  exams  ")
    );
    expect(flow?.id).toBe("exams");
  });

  it("uses list order as the authoritative priority when several flows match", async () => {
    const higherPriority = makeFlow({
      id: "human-help",
      name: "Human help",
      description: "requests that need a person",
      position: 0,
    });
    const lowerPriority = makeFlow({
      id: "assistant-info",
      name: "Assistant information",
      description: "questions about the assistant",
      position: 1,
    });

    const flow = await classifyIntent(
      "Can this assistant put me in touch with a person?",
      [lowerPriority, defaultFlow, higherPriority],
      pickerModel("assistant-info", "human-help")
    );

    expect(flow?.id).toBe("human-help");
  });

  it("falls back to the keyword matcher when the model call fails", async () => {
    const failing = new MockLanguageModelV3({
      doGenerate: () => {
        throw new Error("provider down");
      },
    });
    const flow = await classifyIntent(
      "completely unrelated gibberish",
      [examFlow, defaultFlow],
      failing
    );
    // matchFlow finds no keyword overlap → Default behavior.
    expect(flow?.id).toBe("default");
  });

  it("uses the keyword matcher without calling the model when no classifier is configured", async () => {
    const flow = await classifyIntent(
      "anything at all",
      [examFlow, defaultFlow],
      null
    );
    expect(flow?.id).toBe("default");
  });

  it("never routes disabled, default, or non-message-trigger flows via the classifier", async () => {
    const disabled = makeFlow({ id: "disabled", enabled: false });
    const pageLoad = makeFlow({ id: "page-load", trigger: "page_load" });
    const model = pickerModel("exams");
    await classifyIntent(
      "when is the exam?",
      [examFlow, disabled, pageLoad, defaultFlow],
      model
    );
    const prompt = JSON.stringify(model.doGenerateCalls[0]?.prompt ?? "");
    expect(prompt).toContain("exams");
    expect(prompt).not.toContain("disabled");
    expect(prompt).not.toContain("page-load");
    expect(prompt).not.toContain("id: default");
  });

  it("skips the model entirely when there are no candidate flows", async () => {
    const model = pickerModel();
    const flow = await classifyIntent("hello", [defaultFlow], model);
    expect(model.doGenerateCalls).toHaveLength(0);
    expect(flow?.id).toBe("default");
  });

  it("returns null when every flow is disabled", async () => {
    const off = makeFlow({ id: "off", enabled: false });
    const offDefault = makeFlow({ id: "default", isDefault: true, enabled: false });
    const flow = await classifyIntent("hello", [off, offDefault], null);
    expect(flow).toBeNull();
  });

  it("reports the classify call's usage for the AI ledger", async () => {
    const reported: unknown[] = [];
    await classifyIntent(
      "when is the exam?",
      [examFlow, defaultFlow],
      pickerModel("exams"),
      undefined,
      (usage) => reported.push(usage)
    );
    expect(reported).toHaveLength(1);
    // The SDK flattens usage on the call result; the ledger reads it via
    // usageTotals either way.
    expect(reported[0]).toMatchObject({ inputTokens: 1, outputTokens: 1 });
  });

  it("reports no usage when the call fails or the keyword matcher answers", async () => {
    const reported: unknown[] = [];
    const failing = new MockLanguageModelV3({
      doGenerate: () => {
        throw new Error("provider down");
      },
    });
    await classifyIntent(
      "anything",
      [examFlow, defaultFlow],
      failing,
      undefined,
      (usage) => reported.push(usage)
    );
    await classifyIntent(
      "anything",
      [examFlow, defaultFlow],
      null,
      undefined,
      (usage) => reported.push(usage)
    );
    expect(reported).toHaveLength(0);
  });
});

describe("flowCatalogEntry", () => {
  it("renders id, name and trigger description", () => {
    const entry = flowCatalogEntry(
      makeFlow({ id: "f1", name: "Exams", description: "exam questions" })
    );
    expect(entry).toBe("- id: f1 — name: Exams — triggers when: exam questions");
  });

  it("renders conditions with logic, examples and notes; skips blank examples", () => {
    const entry = flowCatalogEntry(
      makeFlow({
        conditionLogic: "all",
        conditions: [
          {
            id: "c1",
            kind: "conversation_context",
            description: "mentions stress or anxiety",
            examples: [
              { message: "I feel overwhelmed", note: "wellbeing", shouldTrigger: true },
              { message: "exam dates?", note: "", shouldTrigger: false },
              { message: "   ", note: "ignored", shouldTrigger: true },
            ],
          },
        ],
      })
    );
    expect(entry).toContain("Conditions (ALL conditions must match):");
    expect(entry).toContain("• mentions stress or anxiety");
    expect(entry).toContain('- "I feel overwhelmed" matches (wellbeing)');
    expect(entry).toContain('- "exam dates?" does NOT match');
    expect(entry).not.toContain("ignored");
  });
});

/**
 * The shared Flow-action dispatch loop (one loop for both the no-model and
 * model paths): accumulation, templatePatch merge, handover capture, halt,
 * per-action error fallback, and the empty-flow fallback. Exercised through
 * runAssistantChat's no-model path — the model path calls the same helper.
 */
describe("dispatchActions (via runAssistantChat, no-model path)", () => {
  function makeAssistant(overrides: Partial<Assistant> = {}): Assistant {
    return {
      id: "assistant-1",
      organizationId: "org-1",
      title: "Campus Assistant",
      nickname: "Campus AI",
      description: "",
      welcomeMessage: "",
      aiDisclaimer: "",
      suggestedQuestions: [],
      quickReplies: [],
      answeringStyle: "",
      chatLauncherEnabled: true,
      modelProvider: "anthropic",
      modelId: "claude-opus-4-8",
      style: {},
      allowedDomains: [],
      helpDeskSettings: {},
      tools: {},
      requireSignIn: false,
      knowledgeEngine: "graph",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
      ...overrides,
    } as Assistant;
  }

  async function run(flow: Flow) {
    const events: RuntimeEvent[] = [];
    const result = await runAssistantChat({
      assistant: makeAssistant(),
      flows: [flow],
      connections: [],
      message: "hello",
      history: [],
      session: createTurnSession("conv-1", {}),
      emit: (e) => events.push(e),
    });
    return { result, events };
  }

  beforeEach(() => {
    mocked.handlers = {};
  });

  it("runs actions in order, accumulating parts and merging templatePatch", async () => {
    const seenTemplateContexts: unknown[] = [];
    mocked.handlers["api_request"] = async () => ({
      parts: [{ type: "text", action: "api_request", text: "fetched" }],
      templatePatch: { api: { status: 200 } },
    });
    mocked.handlers["custom_message"] = async (ctx) => {
      seenTemplateContexts.push(ctx.templateContext);
      return {
        parts: [{ type: "text", action: "custom_message", text: "done" }],
      };
    };
    const { result } = await run(
      makeFlow({
        id: "default",
        isDefault: true,
        actions: ["api_request", "custom_message"],
      })
    );
    expect(result.parts.map((p) => ("text" in p ? p.text : ""))).toEqual([
      "fetched",
      "done",
    ]);
    // The patch from the first action is visible to the second.
    expect(seenTemplateContexts[0]).toMatchObject({ api: { status: 200 } });
  });

  it("halts on halt and captures handoverTo", async () => {
    const ran: string[] = [];
    mocked.handlers["handover"] = async () => {
      ran.push("handover");
      return {
        parts: [{ type: "text", action: "handover", text: "transferring" }],
        halt: true,
        handoverTo: "assistant-2",
      };
    };
    mocked.handlers["custom_message"] = async () => {
      ran.push("custom_message");
      return { parts: [{ type: "text", action: "custom_message", text: "never" }] };
    };
    const { result } = await run(
      makeFlow({
        id: "default",
        isDefault: true,
        actions: ["handover", "custom_message"],
      })
    );
    expect(ran).toEqual(["handover"]);
    expect(result.handoverTo).toBe("assistant-2");
    expect(result.parts).toHaveLength(1);
  });

  it("turns a throwing action into a fallback part and keeps dispatching", async () => {
    mocked.handlers["send_email"] = async () => {
      throw new Error("smtp down");
    };
    mocked.handlers["custom_message"] = async () => ({
      parts: [{ type: "text", action: "custom_message", text: "still here" }],
    });
    const { result } = await run(
      makeFlow({
        id: "default",
        isDefault: true,
        actions: ["send_email", "custom_message"],
      })
    );
    const texts = result.parts.map((p) => ("text" in p ? p.text : ""));
    expect(texts[0]).toContain('"send_email" step could not be completed');
    expect(texts[1]).toBe("still here");
  });

  it("runs an implicit search_knowledge when the Default behavior flow has no actions", async () => {
    mocked.handlers["search_knowledge"] = async () => ({
      parts: [
        { type: "text", action: "search_knowledge", text: "answer from knowledge" },
      ],
    });
    const { result } = await run(
      makeFlow({
        id: "default",
        name: "Default behavior",
        builtIn: true,
        isDefault: true,
        actions: [],
      })
    );
    expect(result.parts.map((p) => ("text" in p ? p.text : ""))).toEqual([
      "answer from knowledge",
    ]);
  });

  it("runs an implicit search_knowledge for any built-in flow with no actions", async () => {
    // A non-default built-in catch-all (e.g. "Assistant Information") must not
    // dead-end either. Name shares the "hello" token with the run() message so
    // the keyword matcher routes to it without a classifier model.
    mocked.handlers["search_knowledge"] = async () => ({
      parts: [{ type: "text", action: "search_knowledge", text: "grounded answer" }],
    });
    const { result } = await run(
      makeFlow({ id: "info", name: "hello", builtIn: true, isDefault: false, actions: [] })
    );
    expect(result.parts.map((p) => ("text" in p ? p.text : ""))).toEqual([
      "grounded answer",
    ]);
  });

  it("falls back when an admin's own (non-built-in) flow has no actions configured", async () => {
    // Name shares the "hello" token with the run() message so the keyword
    // matcher routes to it (score ≥ threshold) without a classifier model.
    const { result } = await run(
      makeFlow({ id: "flow-1", name: "hello", builtIn: false, isDefault: false, actions: [] })
    );
    expect(result.parts).toHaveLength(1);
    const part = result.parts[0];
    expect("text" in part && part.text).toContain(
      'The flow "hello" matched, but it has no actions configured yet.'
    );
  });
});

/**
 * Ticket #327's core claim: the model path runs the SAME dispatch loop as the
 * no-model path. A platform env key selects the model path; with only the
 * default flow there are no classifier candidates, so no network call is ever
 * made and the mocked handlers observe the loop's semantics directly.
 */
describe("dispatchActions (model path shares the loop)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("merges templatePatch, halts, and captures handoverTo identically", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-test");
    mocked.handlers = {};
    const ran: string[] = [];
    const seenTemplateContexts: unknown[] = [];
    mocked.handlers["api_request"] = async (ctx) => {
      ran.push("api_request");
      // Model path: the resolved chat model is present in the context.
      expect(ctx.chatModel).not.toBeNull();
      return {
        parts: [{ type: "text", action: "api_request", text: "fetched" }],
        templatePatch: { api: { status: 201 } },
      };
    };
    mocked.handlers["handover"] = async (ctx) => {
      ran.push("handover");
      seenTemplateContexts.push(ctx.templateContext);
      return {
        parts: [{ type: "text", action: "handover", text: "transferring" }],
        halt: true,
        handoverTo: "assistant-2",
      };
    };
    mocked.handlers["custom_message"] = async () => {
      ran.push("custom_message");
      return { parts: [{ type: "text", action: "custom_message", text: "never" }] };
    };

    const events: RuntimeEvent[] = [];
    const result = await runAssistantChat({
      assistant: {
        id: "assistant-1",
        organizationId: "org-1",
        title: "Campus Assistant",
        nickname: "Campus AI",
        description: "",
        welcomeMessage: "",
        aiDisclaimer: "",
        suggestedQuestions: [],
        quickReplies: [],
        answeringStyle: "",
        chatLauncherEnabled: true,
        modelProvider: "anthropic",
        modelId: "claude-opus-4-8",
        style: {},
        allowedDomains: [],
        helpDeskSettings: {},
        tools: {},
        requireSignIn: false,
        knowledgeEngine: "graph",
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      } as Assistant,
      flows: [
        makeFlow({
          id: "default",
          isDefault: true,
          actions: ["api_request", "handover", "custom_message"],
        }),
      ],
      connections: [],
      message: "hello",
      history: [],
      session: createTurnSession("conv-1", {}),
      emit: (e) => events.push(e),
    });

    // Same loop semantics as the no-model path: order, halt, handover, patch.
    expect(ran).toEqual(["api_request", "handover"]);
    expect(result.handoverTo).toBe("assistant-2");
    expect(result.parts.map((p) => ("text" in p ? p.text : ""))).toEqual([
      "fetched",
      "transferring",
    ]);
    expect(seenTemplateContexts[0]).toMatchObject({ api: { status: 201 } });
  });
});
