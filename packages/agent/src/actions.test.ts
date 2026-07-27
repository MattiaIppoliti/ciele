import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Assistant, Flow, FlowAction, KnowledgeSearchResult } from "@agent-hub/core";
import type { ChatReplyPart } from "./types";
import { simulateReadableStream } from "ai";
import type { LanguageModel } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { ACTION_HANDLERS } from "./actions";
import { MAX_SEARCH_PASSES, buildSystemPrompt } from "./agentic-search";
import { createTurnSession } from "./session";
import type { ActionContext, RuntimeEvent } from "./types";

// api_request goes through the real egress guard's header policy but a mocked
// network call — assertAllowedHeaders/sanitizeHeaderValue stay real.
vi.mock("./egress", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./egress")>()),
  egressFetch: vi.fn(),
}));
import { egressFetch } from "./egress";

/**
 * Flow Action handlers, tested through the registry interface: each Adapter
 * gets an ActionContext and must return its parts/effects/halt — the engine
 * persists parts and applies effects post-commit (ARCHITECTURE §5.1). The
 * generative search_knowledge loop needs a model and is exercised end-to-end
 * instead (see turn.test.ts for the no-model path).
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
  };
}

function makeContext(overrides: Partial<ActionContext> = {}) {
  const events: RuntimeEvent[] = [];
  const ctx: ActionContext = {
    assistant: makeAssistant(),
    platformPrompt: "",
    flow: makeFlow(),
    message: "hello",
    history: [],
    // Pure handlers never touch the model; the generative one is not unit-tested here.
    chatModel: undefined as unknown as LanguageModel,
    session: createTurnSession("conv-1", {}),
    skills: [],
    priorParts: [],
    emit: (e) => events.push(e),
    ...overrides,
  };
  return { ctx, events };
}

function textPart(text: string): ChatReplyPart {
  return { type: "text", action: "search_knowledge", text };
}

function mockModel(text: string) {
  return new MockLanguageModelV3({
    doGenerate: {
      content: [{ type: "text" as const, text }],
      finishReason: { unified: "stop" as const, raw: "stop" },
      usage: {
        inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
        outputTokens: { total: 1, text: 1, reasoning: undefined },
      },
      warnings: [],
    },
  });
}

const ALL_ACTIONS: FlowAction[] = [
  "search_knowledge",
  "custom_message",
  "suggest_help_desk",
  "follow_up_questions",
  "show_button",
  "iframe",
  "api_request",
  "send_email",
  "improvement",
  "handover",
];

describe("ACTION_HANDLERS registry", () => {
  it("has one Adapter for every FlowAction (no fall-through)", () => {
    for (const action of ALL_ACTIONS) {
      expect(ACTION_HANDLERS[action], action).toBeTypeOf("function");
    }
  });
});

describe("custom_message", () => {
  it("returns the flow's message verbatim (runtime invariant)", async () => {
    const { ctx, events } = makeContext({
      flow: makeFlow({ customMessage: "Exact words." }),
    });
    const result = await ACTION_HANDLERS.custom_message(ctx);
    expect(result.parts).toEqual([
      { type: "text", action: "custom_message", text: "Exact words." },
    ]);
    expect(events).toEqual([{ type: "part", part: result.parts[0] }]);
  });

  it("falls back to a hint when no message is configured", async () => {
    const { ctx } = makeContext({ flow: makeFlow({ name: "Greeting" }) });
    const result = await ACTION_HANDLERS.custom_message(ctx);
    expect(result.parts[0]).toMatchObject({ type: "text" });
    expect((result.parts[0] as { text: string }).text).toContain("Greeting");
  });
});

describe("suggest_help_desk", () => {
  it("uses the configured contact button label", async () => {
    const { ctx } = makeContext({
      assistant: makeAssistant({
        helpDeskSettings: { contactButtonLabel: "Chiedi aiuto" },
      }),
    });
    const result = await ACTION_HANDLERS.suggest_help_desk(ctx);
    expect(result.parts[0]).toMatchObject({
      type: "help_desk",
      label: "Chiedi aiuto",
    });
    // No recommender in context → generic menu (no desk id).
    expect(result.parts[0]).not.toHaveProperty("helpDeskId");
  });

  it("carries the AI-recommended desk id when the recommender resolves one", async () => {
    const { ctx } = makeContext();
    ctx.recommendHelpDesk = async () => "d-admissions";
    const result = await ACTION_HANDLERS.suggest_help_desk(ctx);
    expect(result.parts[0]).toMatchObject({
      type: "help_desk",
      helpDeskId: "d-admissions",
    });
  });
});

describe("follow_up_questions", () => {
  it("caps admin-configured overrides at 3 questions", async () => {
    const { ctx } = makeContext({
      assistant: makeAssistant({ suggestedQuestions: ["1", "2", "3", "4"] }),
    });
    const result = await ACTION_HANDLERS.follow_up_questions(ctx);
    expect(result.parts[0]).toMatchObject({ questions: ["1", "2", "3"] });
  });

  it("falls back to the generic pair when there's no prior answer to ground in", async () => {
    const { ctx } = makeContext();
    const result = await ACTION_HANDLERS.follow_up_questions(ctx);
    expect(
      (result.parts[0] as { questions: string[] }).questions.length
    ).toBeGreaterThan(0);
  });

  it("generates follow-ups grounded in the answer just given this turn", async () => {
    const { ctx } = makeContext({
      chatModel: mockModel(
        JSON.stringify({ questions: ["Dove lavora Alex?", "Che laurea ha?"] })
      ),
      message: "Chi è Alex?",
      priorParts: [textPart("Alex Bianchi lavora alla Acme Corp.")],
    });
    const result = await ACTION_HANDLERS.follow_up_questions(ctx);
    expect((result.parts[0] as { questions: string[] }).questions).toEqual([
      "Dove lavora Alex?",
      "Che laurea ha?",
    ]);
  });

  it("falls back to the generic pair when generation fails", async () => {
    const failing = new MockLanguageModelV3({
      doGenerate: () => {
        throw new Error("provider down");
      },
    });
    const { ctx } = makeContext({
      chatModel: failing,
      priorParts: [textPart("Some grounded answer.")],
    });
    const result = await ACTION_HANDLERS.follow_up_questions(ctx);
    expect((result.parts[0] as { questions: string[] }).questions.length).toBeGreaterThan(
      0
    );
  });
});

describe("show_button / iframe", () => {
  it("emits nothing when unconfigured", async () => {
    const { ctx, events } = makeContext();
    expect((await ACTION_HANDLERS.show_button(ctx)).parts).toEqual([]);
    expect((await ACTION_HANDLERS.iframe(ctx)).parts).toEqual([]);
    expect(events).toEqual([]);
  });

  it("renders the configured button and iframe", async () => {
    const { ctx } = makeContext({
      flow: makeFlow({
        actionSettings: {
          show_button: {
            label: "Open portal",
            type: "external_link",
            url: "https://example.com",
            showIcon: false,
          },
          iframe: { url: "https://example.com/embed" },
        },
      }),
    });
    expect((await ACTION_HANDLERS.show_button(ctx)).parts[0]).toMatchObject({
      type: "button",
      label: "Open portal",
      url: "https://example.com",
      showIcon: false,
    });
    expect((await ACTION_HANDLERS.iframe(ctx)).parts[0]).toMatchObject({
      type: "iframe",
      url: "https://example.com/embed",
    });
  });

  it("normalizes iframe link, title, lightbox, and height", async () => {
    const { ctx } = makeContext({
      flow: makeFlow({
        actionSettings: {
          iframe: {
            url: "example.com/embed",
            title: "  Course map  ",
            lightbox: false,
            height: 60,
            heightUnit: "px",
          },
        },
      }),
    });
    expect((await ACTION_HANDLERS.iframe(ctx)).parts[0]).toMatchObject({
      type: "iframe",
      // bare host gets an https:// protocol so the src is absolute
      url: "https://example.com/embed",
      title: "Course map",
      lightbox: false,
      height: 60,
      heightUnit: "px",
    });
  });

  it("defaults iframe lightbox on and height to 30 vh", async () => {
    const { ctx } = makeContext({
      flow: makeFlow({
        actionSettings: { iframe: { url: "https://example.com/embed" } },
      }),
    });
    expect((await ACTION_HANDLERS.iframe(ctx)).parts[0]).toMatchObject({
      type: "iframe",
      lightbox: true,
      height: 30,
      heightUnit: "vh",
    });
  });

  it("opens the configured help desk button", async () => {
    const { ctx } = makeContext({
      flow: makeFlow({
        actionSettings: {
          show_button: {
            label: "Contact admissions",
            type: "help_desk",
            helpDeskId: "desk-admissions",
          },
        },
      }),
    });
    expect((await ACTION_HANDLERS.show_button(ctx)).parts).toMatchObject([
      {
        type: "help_desk",
        action: "show_button",
        label: "Contact admissions",
        helpDeskId: "desk-admissions",
      },
    ]);
  });

  it("emits interactive buttons for chat text and Knowledge FAQs", async () => {
    const { ctx } = makeContext({
      templateContext: { "user.id": "visitor-42" },
      flow: makeFlow({
        actionSettings: {
          show_button: {
            label: "Tell us more",
            type: "send_text",
            text: "I need help with {{user.id}}",
          },
        },
      }),
    });
    expect((await ACTION_HANDLERS.show_button(ctx)).parts[0]).toMatchObject({
      type: "button",
      buttonType: "send_text",
      text: "I need help with visitor-42",
    });

    const faqContext = {
      ...ctx,
      flow: makeFlow({
        actionSettings: {
          show_button: {
            type: "faq",
            faqId: "faq-enrollment",
            faqQuestion: "How do I enrol?",
          },
        },
      }),
    };
    expect((await ACTION_HANDLERS.show_button(faqContext)).parts[0]).toMatchObject({
      type: "button",
      buttonType: "faq",
      text: "How do I enrol?",
    });
  });

  it("resolves a conversation.metadata template variable in button text", async () => {
    const { ctx } = makeContext({
      templateContext: { "conversation.metadata.city": "Rome" },
      flow: makeFlow({
        actionSettings: {
          show_button: {
            label: "Local help",
            type: "send_text",
            text: "Show services near {{conversation.metadata.city}}",
          },
        },
      }),
    });
    expect((await ACTION_HANDLERS.show_button(ctx)).parts[0]).toMatchObject({
      type: "button",
      buttonType: "send_text",
      text: "Show services near Rome",
    });
  });
});

describe("improvement", () => {
  it("is silent and requests a create_improvement effect", async () => {
    const { ctx, events } = makeContext({ message: "confusing answer here" });
    const result = await ACTION_HANDLERS.improvement(ctx);
    expect(result.parts).toEqual([]);
    expect(events).toEqual([]);
    expect(result.effects).toEqual([
      { kind: "create_improvement", title: "Review: confusing answer here" },
    ]);
  });
});

describe("send_email", () => {
  it("requests a send_email effect only when a recipient is configured", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("EMAIL_FROM", "no-reply@ciele.app");
    try {
      const unconfigured = makeContext();
      expect(
        (await ACTION_HANDLERS.send_email(unconfigured.ctx)).effects
      ).toBeUndefined();

      const { ctx } = makeContext({
        flow: makeFlow({ actionSettings: { send_email: { to: "help@x.it" } } }),
        message: "please forward this",
      });
      const result = await ACTION_HANDLERS.send_email(ctx);
      expect(result.effects).toEqual([
        expect.objectContaining({
          kind: "send_email",
          to: "help@x.it",
          body: "please forward this",
        }),
      ]);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("is honest (and requests no effect) when the transport is not configured", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    try {
      const { ctx } = makeContext({
        flow: makeFlow({ actionSettings: { send_email: { to: "help@x.it" } } }),
        message: "please forward this",
      });
      const result = await ACTION_HANDLERS.send_email(ctx);
      expect(result.effects).toEqual([]);
      expect(result.parts[0]).toMatchObject({ type: "text" });
      expect((result.parts[0] as { text: string }).text).not.toContain(
        "has been forwarded"
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("handover", () => {
  it("halts the flow after acknowledging", async () => {
    const { ctx } = makeContext({
      flow: makeFlow({ actionSettings: { handover: { assistantId: "a2" } } }),
    });
    const result = await ACTION_HANDLERS.handover(ctx);
    expect(result.halt).toBe(true);
    expect(result.parts[0]).toMatchObject({ type: "text", action: "handover" });
  });
});

describe("buildSystemPrompt (prompt layering)", () => {
  it("puts the platform layer first, above the assistant's answering style", () => {
    const prompt = buildSystemPrompt(
      "PLATFORM RULES",
      makeAssistant({ answeringStyle: "Always answer in haiku." }),
      makeFlow({ name: "Default behavior" })
    );
    const platformIdx = prompt.indexOf("PLATFORM RULES");
    const styleIdx = prompt.indexOf("Always answer in haiku.");
    const flowIdx = prompt.indexOf("Default behavior");
    expect(platformIdx).toBeGreaterThanOrEqual(0);
    expect(styleIdx).toBeGreaterThan(platformIdx);
    expect(flowIdx).toBeGreaterThan(styleIdx);
    expect(prompt).toContain("immutable — highest precedence");
  });

  it("omits the answering-style block when the org left it empty", () => {
    const prompt = buildSystemPrompt(
      "PLATFORM RULES",
      makeAssistant({ answeringStyle: "   " }),
      makeFlow()
    );
    expect(prompt).not.toContain("answering-style instructions");
  });

  it("layers attached skills between the style and the flow context", () => {
    const prompt = buildSystemPrompt(
      "PLATFORM RULES",
      makeAssistant({ answeringStyle: "Always answer in haiku." }),
      makeFlow({ name: "Default behavior" }),
      {
        skills: [
          {
            id: "sk-1",
            name: "Citations",
            description: "",
            prompt: "Cite official documents by name.",
          },
        ],
      }
    );
    const styleIdx = prompt.indexOf("Always answer in haiku.");
    const skillIdx = prompt.indexOf("Cite official documents by name.");
    const flowIdx = prompt.indexOf("Default behavior");
    expect(prompt).toContain("## Skill: Citations");
    expect(skillIdx).toBeGreaterThan(styleIdx);
    expect(flowIdx).toBeGreaterThan(skillIdx);
  });

  it("includes session memory and omits empty skills/memory blocks", () => {
    const withMemory = buildSystemPrompt(
      "P",
      makeAssistant(),
      makeFlow(),
      { memory: ["Student is enrolled in Marketing (A)"] }
    );
    expect(withMemory).toContain("# Session memory");
    expect(withMemory).toContain("- Student is enrolled in Marketing (A)");

    const bare = buildSystemPrompt("P", makeAssistant(), makeFlow());
    expect(bare).not.toContain("# Attached skills");
    expect(bare).not.toContain("# Session memory");
  });

  it("layers the flow's answering style on top of the org default by default", () => {
    const prompt = buildSystemPrompt(
      "P",
      makeAssistant({ answeringStyle: "Always answer in haiku." }),
      makeFlow(),
      { flowStyle: { answeringStyle: "Keep it under two sentences." } }
    );
    expect(prompt).toContain("Always answer in haiku.");
    expect(prompt).toContain("Additional answering-style instructions for this flow");
    expect(prompt).toContain("Keep it under two sentences.");
  });

  it("replaces the org answering style when the flow overrides it", () => {
    const prompt = buildSystemPrompt(
      "P",
      makeAssistant({ answeringStyle: "Always answer in haiku." }),
      makeFlow(),
      {
        flowStyle: {
          answeringStyle: "Reply only in formal French.",
          overrideAnsweringStyle: true,
        },
      }
    );
    expect(prompt).toContain("Reply only in formal French.");
    expect(prompt).not.toContain("Always answer in haiku.");
    expect(prompt).not.toContain("Additional answering-style instructions");
  });

  it("adds flow search guidelines to the routing context", () => {
    const prompt = buildSystemPrompt("P", makeAssistant(), makeFlow(), {
      flowStyle: { searchGuidelines: "Also search related deadlines." },
    });
    expect(prompt).toContain("Search guidelines for this flow");
    expect(prompt).toContain("Also search related deadlines.");
  });
});

describe("search_knowledge finish reasons (refusal & truncation)", () => {
  function streamingModel(input: {
    deltas?: string[];
    unified: "stop" | "length" | "content-filter";
    raw?: string;
  }) {
    return new MockLanguageModelV3({
      doStream: {
        stream: simulateReadableStream({
          chunks: [
            { type: "stream-start" as const, warnings: [] },
            { type: "text-start" as const, id: "1" },
            ...(input.deltas ?? []).map((delta) => ({
              type: "text-delta" as const,
              id: "1",
              delta,
            })),
            { type: "text-end" as const, id: "1" },
            {
              type: "finish" as const,
              finishReason: { unified: input.unified, raw: input.raw ?? input.unified },
              usage: {
                inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
                outputTokens: { total: 5, text: 5, reasoning: undefined },
              },
            },
          ],
        }),
      },
    });
  }

  it("answers a refusal honestly with the escalation offer (no retry)", async () => {
    const model = streamingModel({ unified: "content-filter", raw: "refusal" });
    const { ctx } = makeContext({ chatModel: model as unknown as LanguageModel });
    const result = await ACTION_HANDLERS.search_knowledge(ctx);

    expect(result.parts.map((p) => p.type)).toEqual(["text", "help_desk"]);
    const text = (result.parts[0] as { action: string; text: string });
    expect(text.action).toBe("refusal");
    expect(text.text).toContain("can't help with that request");
    // Never dressed up as a knowledge gap, no provider internals on the widget.
    expect(text.text).not.toContain("knowledge base");
    expect(text.text).not.toContain("refusal");
    // Exactly one generative invocation: refusals are not shopped around.
    expect(model.doStreamCalls).toHaveLength(1);
  });

  it("shows the raw finish reason only on the preview surface", async () => {
    const model = streamingModel({ unified: "content-filter", raw: "refusal" });
    const { ctx } = makeContext({
      chatModel: model as unknown as LanguageModel,
      previewSurface: true,
    });
    const result = await ACTION_HANDLERS.search_knowledge(ctx);
    expect((result.parts[0] as { text: string }).text).toContain(
      "Provider finish reason: refusal"
    );
  });

  it("labels a length-truncated answer instead of pretending nothing was found", async () => {
    const model = streamingModel({ unified: "length", deltas: ["Partial ans"] });
    const { ctx } = makeContext({ chatModel: model as unknown as LanguageModel });
    const result = await ACTION_HANDLERS.search_knowledge(ctx);

    expect(result.parts.map((p) => p.type)).toEqual(["text", "text"]);
    expect((result.parts[0] as { text: string }).text).toBe("Partial ans");
    expect((result.parts[1] as { text: string }).text).toContain("cut short");
    // Truncation offers no escalation push.
    expect(result.parts.some((p) => p.type === "help_desk")).toBe(false);
  });

  it("keeps the normal path unchanged and meters usage", async () => {
    const model = streamingModel({ unified: "stop", deltas: ["All good."] });
    const usage: { inputTokens: number; outputTokens: number }[] = [];
    const { ctx } = makeContext({
      chatModel: model as unknown as LanguageModel,
      recordUsage: (u) => usage.push(u),
    });
    const result = await ACTION_HANDLERS.search_knowledge(ctx);
    expect(result.parts[0]).toMatchObject({
      type: "text",
      action: "search_knowledge",
      text: "All good.",
    });
    expect(usage).toEqual([{ inputTokens: 10, outputTokens: 5 }]);
  });

  it("preserves a structured provider error from the AI SDK stream", async () => {
    const model = new MockLanguageModelV3({
      doStream: {
        stream: simulateReadableStream({
          chunks: [
            { type: "stream-start" as const, warnings: [] },
            {
              type: "error" as const,
              error: { message: "Invalid local inference invocation." },
            },
          ],
        }),
      },
    });
    const { ctx } = makeContext({
      chatModel: model as unknown as LanguageModel,
      previewSurface: true,
    });

    await expect(ACTION_HANDLERS.search_knowledge(ctx)).rejects.toThrow(
      "Invalid local inference invocation."
    );
  });

  it("creates an improvement when an enabled knowledge search is ungrounded", async () => {
    const model = streamingModel({ unified: "stop", deltas: ["I could not verify that."] });
    const { ctx } = makeContext({
      chatModel: model as unknown as LanguageModel,
      flow: makeFlow({
        actionSettings: { search_knowledge: { improvementItems: true } },
      }),
      message: "What is the unpublished deadline?",
    });

    const result = await ACTION_HANDLERS.search_knowledge(ctx);

    expect(result.effects).toEqual([
      {
        kind: "create_improvement",
        title: "Review: What is the unpublished deadline?",
      },
    ]);
  });
});

describe("search_knowledge iteration budget + coverage gate (Agentic Search)", () => {
  const mockUsage = () => ({
    inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
    outputTokens: { total: 1, text: 1, reasoning: undefined },
  });

  /** A model step that calls searchKnowledge, driving another loop iteration. */
  function searchStep(id: string, query: string) {
    return {
      stream: simulateReadableStream({
        chunks: [
          { type: "stream-start" as const, warnings: [] },
          { type: "tool-input-start" as const, id, toolName: "searchKnowledge" },
          { type: "tool-input-delta" as const, id, delta: JSON.stringify({ query }) },
          { type: "tool-input-end" as const, id },
          {
            type: "tool-call" as const,
            toolCallId: id,
            toolName: "searchKnowledge",
            input: JSON.stringify({ query }),
          },
          {
            type: "finish" as const,
            finishReason: { unified: "tool-calls" as const, raw: "tool_calls" },
            usage: mockUsage(),
          },
        ],
      }),
    };
  }

  /** A model step that streams a final answer and stops. */
  function answerStep(text: string) {
    return {
      stream: simulateReadableStream({
        chunks: [
          { type: "stream-start" as const, warnings: [] },
          { type: "text-start" as const, id: "t" },
          { type: "text-delta" as const, id: "t", delta: text },
          { type: "text-end" as const, id: "t" },
          {
            type: "finish" as const,
            finishReason: { unified: "stop" as const, raw: "stop" },
            usage: mockUsage(),
          },
        ],
      }),
    };
  }

  const strongResult: KnowledgeSearchResult = {
    conceptId: "k1",
    conceptTitle: "Enrollment deadline",
    conceptPath: "enrollment.md",
    collectionId: "col1",
    collectionName: "Admissions",
    sourceName: "Handbook",
    resourceUrl: "https://example.edu/handbook",
    content: "Enrollment closes on 30 September.",
    similarity: 0.92,
  };

  it("caps a keeps-finding-nothing turn at 6 searches, then a caveated answer (never empty)", async () => {
    let seq = 0;
    // Always asks to search again with a fresh query — the budget, not the
    // model, must terminate the loop.
    const model = new MockLanguageModelV3({
      doStream: async () => searchStep(`call-${++seq}`, `attempt ${seq}`),
    });
    const searchKnowledge = vi.fn(async () => [] as KnowledgeSearchResult[]);
    // The conversation already clarified once, so the empty-conflicting dead-end
    // takes the best-effort caveat path (not a second clarify — #156 guardrail).
    const { ctx } = makeContext({
      chatModel: model as unknown as LanguageModel,
      searchKnowledge,
      message: "something not in the knowledge base",
      alreadyClarified: true,
    });

    const result = await ACTION_HANDLERS.search_knowledge(ctx);

    // At most 6 searchKnowledge calls — and no 7th model generation.
    expect(searchKnowledge).toHaveBeenCalledTimes(MAX_SEARCH_PASSES);
    expect(model.doStreamCalls.length).toBe(MAX_SEARCH_PASSES);

    // A single caveated best-effort text part — never a bare empty bubble.
    const textParts = result.parts.filter(
      (p): p is Extract<ChatReplyPart, { type: "text" }> => p.type === "text"
    );
    expect(textParts).toHaveLength(1);
    expect(textParts[0].text.trim().length).toBeGreaterThan(0);
    expect(textParts[0].text).toContain("couldn't find");
    // The caveat names what it actually searched for.
    expect(textParts[0].text).toContain("attempt 1");
    // Nothing grounded it, so no Sources part.
    expect(result.parts.some((p) => p.type === "sources")).toBe(false);
  });

  it("stops as soon as a pass grounds the answer and still emits a deduped Sources part", async () => {
    const model = new MockLanguageModelV3({
      doStream: [
        searchStep("call-1", "when does enrollment close"),
        answerStep("Enrollment closes on 30 September."),
      ],
    });
    const searchKnowledge = vi.fn(async () => [strongResult]);
    const events: RuntimeEvent[] = [];
    const { ctx } = makeContext({
      chatModel: model as unknown as LanguageModel,
      searchKnowledge,
      message: "when does enrollment close?",
      emit: (e) => events.push(e),
    });

    const result = await ACTION_HANDLERS.search_knowledge(ctx);

    expect(searchKnowledge).toHaveBeenCalledTimes(1);
    const answer = result.parts.find(
      (p): p is Extract<ChatReplyPart, { type: "text" }> => p.type === "text"
    );
    expect(answer?.text).toBe("Enrollment closes on 30 September.");

    // Provenance unchanged: a grounded answer resolves Concept → Source.
    const sources = result.parts.find(
      (p): p is Extract<ChatReplyPart, { type: "sources" }> => p.type === "sources"
    );
    expect(sources?.sources[0]).toMatchObject({
      conceptId: "k1",
      conceptTitle: "Enrollment deadline",
      sourceName: "Handbook",
    });
    // The Sources part reached the wire too.
    expect(
      events.some((e) => e.type === "part" && e.part.type === "sources")
    ).toBe(true);
  });
});

describe("search_knowledge query understanding + context frame (Agentic Search #154)", () => {
  const mockUsage = () => ({
    inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
    outputTokens: { total: 1, text: 1, reasoning: undefined },
  });

  function searchStep(id: string, query: string) {
    return {
      stream: simulateReadableStream({
        chunks: [
          { type: "stream-start" as const, warnings: [] },
          { type: "tool-call" as const, toolCallId: id, toolName: "searchKnowledge", input: JSON.stringify({ query }) },
          { type: "finish" as const, finishReason: { unified: "tool-calls" as const, raw: "tool_calls" }, usage: mockUsage() },
        ],
      }),
    };
  }

  function answerStep(text: string) {
    return {
      stream: simulateReadableStream({
        chunks: [
          { type: "stream-start" as const, warnings: [] },
          { type: "text-start" as const, id: "t" },
          { type: "text-delta" as const, id: "t", delta: text },
          { type: "text-end" as const, id: "t" },
          { type: "finish" as const, finishReason: { unified: "stop" as const, raw: "stop" }, usage: mockUsage() },
        ],
      }),
    };
  }

  const costPush: KnowledgeSearchResult = {
    conceptId: "k2",
    conceptTitle: "Cost-push inflation",
    conceptPath: "inflation.md",
    collectionId: "col-1",
    collectionName: "Economics",
    sourceName: "Macro notes",
    resourceUrl: "https://example.edu/macro",
    content: "Cost-push inflation happens when production costs rise.",
    similarity: 0.9,
  };

  it("seeds the first searchKnowledge query with a deictic follow-up's resolved subject", async () => {
    const searchKnowledge = vi.fn<(q: string) => Promise<KnowledgeSearchResult[]>>(async () => [costPush]);
    // Model answers straight away (no tool call): the seeded pass is the only search.
    const model = new MockLanguageModelV3({
      doStream: [answerStep("Cost-push inflation is when production costs rise.")],
    });
    const { ctx } = makeContext({
      chatModel: model as unknown as LanguageModel,
      searchKnowledge,
      message: "what about the second one?",
      collectionId: "col-1",
      history: [
        { role: "user", text: "What are the main causes of inflation?" },
        {
          role: "assistant",
          text: "Causes:\n1. Demand-pull inflation\n2. Cost-push inflation\n3. Built-in inflation",
        },
      ],
    });

    const result = await ACTION_HANDLERS.search_knowledge(ctx);

    // The resolved subject (2nd list item), not the raw pronoun, drives the first search.
    expect(searchKnowledge).toHaveBeenCalledTimes(1);
    expect(searchKnowledge.mock.calls[0]![0].toLowerCase()).toContain("cost-push");

    // Provenance unchanged: the seeded hit resolves Concept → Source.
    const sources = result.parts.find(
      (p): p is Extract<ChatReplyPart, { type: "sources" }> => p.type === "sources"
    );
    expect(sources?.sources[0]).toMatchObject({ conceptId: "k2", sourceName: "Macro notes" });

    // The context frame reached the system prompt: Collection-first scope + seeded findings.
    const sentToModel = JSON.stringify(model.doStreamCalls[0]);
    expect(sentToModel).toContain("search that collection first");
    expect(sentToModel).toContain("Initial knowledge-base results");
  });

  it("asks a focused question instead of searching a reference it cannot resolve (#156)", async () => {
    // Slice #156 supersedes the earlier "degrade to the raw message" behavior:
    // an unresolvable deictic message ("what about the second one?" with no
    // antecedent) has nothing usable to search, so the turn clarifies rather
    // than searching the bare pronoun and guessing.
    const searchKnowledge = vi.fn<(q: string) => Promise<KnowledgeSearchResult[]>>(async () => [costPush]);
    const model = new MockLanguageModelV3({
      doStream: [answerStep("this should never run")],
    });
    const { ctx } = makeContext({
      chatModel: model as unknown as LanguageModel,
      searchKnowledge,
      message: "what about the second one?",
      history: [],
    });

    const result = await ACTION_HANDLERS.search_knowledge(ctx);

    // Terminal, pre-search: nothing searched, nothing generated.
    expect(searchKnowledge).not.toHaveBeenCalled();
    expect(model.doStreamCalls).toHaveLength(0);
    expect(result.parts).toHaveLength(1);
    expect(result.parts[0]).toMatchObject({ type: "clarify", action: "search_knowledge" });
  });

  it("leaves a self-contained question's first search to the model (no seeding)", async () => {
    const searchKnowledge = vi.fn<(q: string) => Promise<KnowledgeSearchResult[]>>(async () => [costPush]);
    const model = new MockLanguageModelV3({
      doStream: [searchStep("c1", "enrollment deadline"), answerStep("The deadline is 30 September.")],
    });
    const { ctx } = makeContext({
      chatModel: model as unknown as LanguageModel,
      searchKnowledge,
      message: "When is the enrollment deadline?",
      history: [{ role: "user", text: "Hi" }],
    });

    await ACTION_HANDLERS.search_knowledge(ctx);

    // Only the model's own tool query ran — the handler seeded nothing.
    expect(searchKnowledge).toHaveBeenCalledTimes(1);
    expect(searchKnowledge.mock.calls[0]![0]).toBe("enrollment deadline");
  });
});

describe("search_knowledge reformulating passes (Agentic Search #155)", () => {
  const mockUsage = () => ({
    inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
    outputTokens: { total: 1, text: 1, reasoning: undefined },
  });

  function searchStep(id: string, query: string) {
    return {
      stream: simulateReadableStream({
        chunks: [
          { type: "stream-start" as const, warnings: [] },
          { type: "tool-call" as const, toolCallId: id, toolName: "searchKnowledge", input: JSON.stringify({ query }) },
          { type: "finish" as const, finishReason: { unified: "tool-calls" as const, raw: "tool_calls" }, usage: mockUsage() },
        ],
      }),
    };
  }

  function answerStep(text: string) {
    return {
      stream: simulateReadableStream({
        chunks: [
          { type: "stream-start" as const, warnings: [] },
          { type: "text-start" as const, id: "t" },
          { type: "text-delta" as const, id: "t", delta: text },
          { type: "text-end" as const, id: "t" },
          { type: "finish" as const, finishReason: { unified: "stop" as const, raw: "stop" }, usage: mockUsage() },
        ],
      }),
    };
  }

  // A thin collection hit (below the strong-similarity bar → `insufficient`).
  const thinCollectionHit: KnowledgeSearchResult = {
    conceptId: "c-thin",
    conceptTitle: "Reading week (partial)",
    conceptPath: "reading-week.md",
    collectionId: "col-1",
    collectionName: "Marketing 101",
    sourceName: "Course page",
    resourceUrl: "https://example.edu/mkt/reading-week",
    content: "Reading week is mentioned but the schedule isn't here.",
    similarity: 0.5,
  };
  // A strong assistant-wide hit (surfaced only once the scope widens).
  const strongWideHit: KnowledgeSearchResult = {
    conceptId: "c-strong",
    conceptTitle: "Reading week schedule",
    conceptPath: "academic-calendar.md",
    collectionId: "col-calendar",
    collectionName: "Academic calendar",
    sourceName: "Registrar",
    resourceUrl: "https://example.edu/calendar",
    content: "Reading week runs 10–14 November across all programmes.",
    similarity: 0.94,
  };

  it("reformulates a thin scoped first pass into a rephrased, widened second pass", async () => {
    // Collection-scoped pass is thin; the assistant-wide pass grounds it.
    const searchKnowledge = vi.fn<
      (q: string, opts?: { scope?: "collection" | "assistant" }) => Promise<KnowledgeSearchResult[]>
    >(async (_q, opts) => (opts?.scope === "assistant" ? [strongWideHit] : [thinCollectionHit]));
    // Model answers from the seeded findings (no tool call of its own).
    const model = new MockLanguageModelV3({
      doStream: [answerStep("Reading week runs 10–14 November.")],
    });
    const { ctx } = makeContext({
      chatModel: model as unknown as LanguageModel,
      searchKnowledge,
      message: "what is the reading week schedule?",
      collectionId: "col-1",
      history: [],
    });

    const result = await ACTION_HANDLERS.search_knowledge(ctx);

    // Exactly one reformulation: a Collection-scoped pass, then an assistant-wide one.
    expect(searchKnowledge).toHaveBeenCalledTimes(2);
    // First pass stays Collection-scoped, on the understood (raw) query.
    expect(searchKnowledge.mock.calls[0]![0]).toBe("what is the reading week schedule?");
    expect(searchKnowledge.mock.calls[0]![1]?.scope ?? "collection").toBe("collection");
    // Second pass drops the collection scope AND rephrases the query.
    expect(searchKnowledge.mock.calls[1]![1]?.scope).toBe("assistant");
    expect(searchKnowledge.mock.calls[1]![0]).toBe("reading week schedule");

    // A grounded answer after widening still cites Concept → Source.
    const sources = result.parts.find(
      (p): p is Extract<ChatReplyPart, { type: "sources" }> => p.type === "sources"
    );
    expect(sources?.sources.some((s) => s.conceptId === "c-strong")).toBe(true);
  });

  it("keeps total searches within the budget across reformulations, then a caveated answer", async () => {
    // Everything is empty; a model that never stops searching must still be
    // capped at MAX_SEARCH_PASSES across the deterministic + model passes.
    let seq = 0;
    const searchKnowledge = vi.fn<
      (q: string, opts?: { scope?: "collection" | "assistant" }) => Promise<KnowledgeSearchResult[]>
    >(async () => [] as KnowledgeSearchResult[]);
    const model = new MockLanguageModelV3({
      doStream: async () => searchStep(`m-${++seq}`, `model attempt ${seq}`),
    });
    // Already clarified once → the dead-end caveats rather than re-clarifying.
    const { ctx } = makeContext({
      chatModel: model as unknown as LanguageModel,
      searchKnowledge,
      message: "an obscure thing not in the knowledge base",
      collectionId: "col-1",
      history: [],
      alreadyClarified: true,
    });

    const result = await ACTION_HANDLERS.search_knowledge(ctx);

    // Never more than the slice-1 budget, and the deterministic phase widened.
    expect(searchKnowledge.mock.calls.length).toBeLessThanOrEqual(MAX_SEARCH_PASSES);
    expect(searchKnowledge.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(searchKnowledge.mock.calls[0]![1]?.scope ?? "collection").toBe("collection");
    expect(searchKnowledge.mock.calls[1]![1]?.scope).toBe("assistant");

    // A single caveated best-effort text part — never a bare empty bubble, no sources.
    const textParts = result.parts.filter(
      (p): p is Extract<ChatReplyPart, { type: "text" }> => p.type === "text"
    );
    expect(textParts).toHaveLength(1);
    expect(textParts[0].text).toContain("couldn't find");
    expect(result.parts.some((p) => p.type === "sources")).toBe(false);
  });
});

describe("search_knowledge terminal clarify + anti-loop guardrail (Agentic Search #156)", () => {
  const mockUsage = () => ({
    inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
    outputTokens: { total: 1, text: 1, reasoning: undefined },
  });

  /** A model step that searches (drives the loop) — the model "keeps trying". */
  function searchStep(id: string, query: string) {
    return {
      stream: simulateReadableStream({
        chunks: [
          { type: "stream-start" as const, warnings: [] },
          { type: "tool-call" as const, toolCallId: id, toolName: "searchKnowledge", input: JSON.stringify({ query }) },
          { type: "finish" as const, finishReason: { unified: "tool-calls" as const, raw: "tool_calls" }, usage: mockUsage() },
        ],
      }),
    };
  }

  function answerStep(text: string) {
    return {
      stream: simulateReadableStream({
        chunks: [
          { type: "stream-start" as const, warnings: [] },
          { type: "text-start" as const, id: "t" },
          { type: "text-delta" as const, id: "t", delta: text },
          { type: "text-end" as const, id: "t" },
          { type: "finish" as const, finishReason: { unified: "stop" as const, raw: "stop" }, usage: mockUsage() },
        ],
      }),
    };
  }

  const clarifyParts = (parts: ChatReplyPart[]) =>
    parts.filter((p): p is Extract<ChatReplyPart, { type: "clarify" }> => p.type === "clarify");

  it("clarifies an underspecified message pre-search — never a fabricated answer", async () => {
    const searchKnowledge = vi.fn(async () => [] as KnowledgeSearchResult[]);
    const model = new MockLanguageModelV3({ doStream: [answerStep("should not run")] });
    const events: RuntimeEvent[] = [];
    const { ctx } = makeContext({
      chatModel: model as unknown as LanguageModel,
      searchKnowledge,
      message: "what about the third one?",
      history: [],
      emit: (e) => events.push(e),
    });

    const result = await ACTION_HANDLERS.search_knowledge(ctx);

    // No search, no generation, no guessed answer — exactly one clarify.
    expect(searchKnowledge).not.toHaveBeenCalled();
    expect(model.doStreamCalls).toHaveLength(0);
    expect(clarifyParts(result.parts)).toHaveLength(1);
    expect(result.parts).toHaveLength(1);
    const clarify = clarifyParts(result.parts)[0];
    expect(clarify.question.length).toBeGreaterThan(0);
    // It reached the wire through the existing `part` event (no new event type).
    expect(events.some((e) => e.type === "part" && e.part.type === "clarify")).toBe(true);
  });

  it("clarifies post-search when every pass is empty/conflicting, naming what it surfaced", async () => {
    // A self-contained question; the model searches and only weak noise comes
    // back (below the relevance floor → empty-conflicting), then it stops
    // without answering.
    const weak: KnowledgeSearchResult = {
      conceptId: "w1",
      conceptTitle: "Reading week (mention only)",
      conceptPath: "x.md",
      collectionId: "col",
      collectionName: "Marketing",
      sourceName: "Course page",
      resourceUrl: null,
      content: "reading week is referenced but not described",
      similarity: 0.2,
    };
    const searchKnowledge = vi.fn(async () => [weak]);
    // The model keeps searching (never synthesizes) — the budget ends the loop
    // with no final text, so the empty-conflicting coverage gate clarifies.
    let seq = 0;
    const model = new MockLanguageModelV3({
      doStream: async () => searchStep(`c-${++seq}`, `reading week ${seq}`),
    });
    const { ctx } = makeContext({
      chatModel: model as unknown as LanguageModel,
      searchKnowledge,
      message: "what is the reading week schedule?",
      history: [],
    });

    const result = await ACTION_HANDLERS.search_knowledge(ctx);

    const clarify = clarifyParts(result.parts);
    expect(clarify).toHaveLength(1);
    expect(clarify[0].found).toEqual(["Reading week (mention only)"]);
    // No fabricated text answer, no sources on an empty-conflicting dead-end.
    expect(result.parts.some((p) => p.type === "text")).toBe(false);
    expect(result.parts.some((p) => p.type === "sources")).toBe(false);
  });

  it("guardrail: a second underspecified turn gives a caveated best-effort, not a 2nd clarify", async () => {
    // The conversation already clarified once. A model that keeps finding
    // nothing must terminate in a caveated best-effort answer — never a clarify.
    let seq = 0;
    const searchKnowledge = vi.fn(async () => [] as KnowledgeSearchResult[]);
    const model = new MockLanguageModelV3({
      doStream: async () => searchStep(`m-${++seq}`, `attempt ${seq}`),
    });
    const { ctx } = makeContext({
      chatModel: model as unknown as LanguageModel,
      searchKnowledge,
      message: "what about the third one?",
      history: [],
      alreadyClarified: true,
    });

    const result = await ACTION_HANDLERS.search_knowledge(ctx);

    // No clarify anywhere (pre- or post-search) — the guardrail held.
    expect(clarifyParts(result.parts)).toHaveLength(0);
    // A single caveated best-effort text part instead.
    const textParts = result.parts.filter(
      (p): p is Extract<ChatReplyPart, { type: "text" }> => p.type === "text"
    );
    expect(textParts).toHaveLength(1);
    expect(textParts[0].text).toContain("couldn't find");
    // The budget still capped the runaway search loop.
    expect(searchKnowledge.mock.calls.length).toBeLessThanOrEqual(MAX_SEARCH_PASSES);
  });

  it("does not clarify a grounded answer — provenance stays Concept → Source", async () => {
    const strong: KnowledgeSearchResult = {
      conceptId: "s1",
      conceptTitle: "Enrollment deadline",
      conceptPath: "x.md",
      collectionId: "col",
      collectionName: "Admissions",
      sourceName: "Handbook",
      resourceUrl: "https://example.edu/handbook",
      content: "Enrollment closes 30 September.",
      similarity: 0.93,
    };
    const searchKnowledge = vi.fn(async () => [strong]);
    const model = new MockLanguageModelV3({
      doStream: [searchStep("c1", "enrollment deadline"), answerStep("Enrollment closes 30 September.")],
    });
    const { ctx } = makeContext({
      chatModel: model as unknown as LanguageModel,
      searchKnowledge,
      message: "when is the enrollment deadline?",
      history: [],
    });

    const result = await ACTION_HANDLERS.search_knowledge(ctx);

    expect(clarifyParts(result.parts)).toHaveLength(0);
    const sources = result.parts.find(
      (p): p is Extract<ChatReplyPart, { type: "sources" }> => p.type === "sources"
    );
    expect(sources?.sources[0]).toMatchObject({ conceptId: "s1", sourceName: "Handbook" });
  });
});

describe("api_request", () => {
  const egressFetchMock = vi.mocked(egressFetch);

  function ok() {
    return {
      response: {
        status: 200,
        ok: true,
        headers: new Headers(),
        text: "{}",
      },
      finalUrl: "https://api.example.com/",
    };
  }

  beforeEach(() => {
    egressFetchMock.mockReset();
    egressFetchMock.mockResolvedValue(ok() as never);
  });

  function apiFlow(api: NonNullable<Flow["actionSettings"]>["api_request"]) {
    return makeFlow({ actionSettings: { api_request: api } });
  }

  it("emits nothing when no URL is configured", async () => {
    const { ctx } = makeContext({ flow: apiFlow({ method: "POST" }) });
    expect((await ACTION_HANDLERS.api_request(ctx)).parts).toEqual([]);
    expect(egressFetchMock).not.toHaveBeenCalled();
  });

  it("sends method, url and body through the egress guard on success", async () => {
    const { ctx } = makeContext({
      message: "hello",
      flow: apiFlow({ method: "POST", url: "https://api.example.com/hook" }),
    });
    const result = await ACTION_HANDLERS.api_request(ctx);
    const [url, options] = egressFetchMock.mock.calls[0];
    expect(url).toBe("https://api.example.com/hook");
    expect(options.method).toBe("POST");
    expect(options.body).toBe(JSON.stringify({ message: "hello" }));
    expect((result.parts[0] as { text: string }).text).toMatch(/successfully/i);
  });

  it("composes each auth type into a header, never leaking the secret to parts", async () => {
    const bearer = makeContext({
      flow: apiFlow({
        url: "https://api.example.com/",
        auth: { type: "bearer", token: "s3cret" },
      }),
    });
    const bearerResult = await ACTION_HANDLERS.api_request(bearer.ctx);
    expect(egressFetchMock.mock.calls[0][1].headers?.authorization).toBe(
      "Bearer s3cret"
    );
    expect(JSON.stringify(bearerResult.parts)).not.toContain("s3cret");
    expect(JSON.stringify(bearer.events)).not.toContain("s3cret");

    egressFetchMock.mockClear();
    const apiKey = makeContext({
      flow: apiFlow({
        url: "https://api.example.com/",
        auth: { type: "api_key", header: "X-API-Key", key: "abc123" },
      }),
    });
    await ACTION_HANDLERS.api_request(apiKey.ctx);
    expect(egressFetchMock.mock.calls[0][1].headers?.["X-API-Key"]).toBe("abc123");

    egressFetchMock.mockClear();
    const basic = makeContext({
      flow: apiFlow({
        url: "https://api.example.com/",
        auth: { type: "basic", username: "ada", password: "pw" },
      }),
    });
    await ACTION_HANDLERS.api_request(basic.ctx);
    expect(egressFetchMock.mock.calls[0][1].headers?.authorization).toBe(
      `Basic ${Buffer.from("ada:pw").toString("base64")}`
    );
  });

  it("appends query parameters and resolves template variables in url/headers/query", async () => {
    const { ctx } = makeContext({
      templateContext: { "user.id": "u-7", "conversation.metadata.city": "Rome" },
      flow: apiFlow({
        method: "GET",
        url: "https://api.example.com/{{user.id}}",
        headers: [{ id: "h1", name: "X-City", value: "{{conversation.metadata.city}}" }],
        queryParams: [{ id: "q1", name: "city", value: "{{conversation.metadata.city}}" }],
      }),
    });
    await ACTION_HANDLERS.api_request(ctx);
    const [url, options] = egressFetchMock.mock.calls[0];
    expect(url).toBe("https://api.example.com/u-7?city=Rome");
    expect(options.headers?.["X-City"]).toBe("Rome");
    expect(options.method).toBe("GET");
    expect(options.body).toBeUndefined();
  });

  it("rejects a denylisted admin header before making any request", async () => {
    const { ctx } = makeContext({
      flow: apiFlow({
        url: "https://api.example.com/",
        headers: [{ id: "h1", name: "Host", value: "evil.example" }],
      }),
    });
    const result = await ACTION_HANDLERS.api_request(ctx);
    expect(egressFetchMock).not.toHaveBeenCalled();
    expect((result.parts[0] as { text: string }).text).toMatch(/couldn't be completed/i);
  });

  it("reports a generic failure when the egress guard blocks the target", async () => {
    egressFetchMock.mockRejectedValueOnce(new Error("blocked_address"));
    const { ctx } = makeContext({
      flow: apiFlow({ url: "https://169.254.169.254/" }),
    });
    const result = await ACTION_HANDLERS.api_request(ctx);
    const text = (result.parts[0] as { text: string }).text;
    expect(text).toMatch(/couldn't be completed/i);
    expect(text).not.toMatch(/169\.254|blocked/i);
  });

  it("resolves a JSON body template with JSON-string escaping, staying valid JSON", async () => {
    const { ctx } = makeContext({
      templateContext: { "workflow.message": 'he said "hi"\nbye' },
      flow: apiFlow({
        method: "POST",
        url: "https://api.example.com/",
        bodyTemplate: '{"msg":"{{workflow.message}}"}',
      }),
    });
    await ACTION_HANDLERS.api_request(ctx);
    const body = egressFetchMock.mock.calls[0][1].body as string;
    expect(JSON.parse(body)).toEqual({ msg: 'he said "hi"\nbye' });
  });

  it("rejects a template variable in the URL origin (host injection)", async () => {
    const { ctx } = makeContext({
      templateContext: { "user.id": "evil.example" },
      flow: apiFlow({ url: "https://{{user.id}}/path" }),
    });
    const result = await ACTION_HANDLERS.api_request(ctx);
    expect(egressFetchMock).not.toHaveBeenCalled();
    expect((result.parts[0] as { text: string }).text).toMatch(
      /couldn't be completed/i
    );
  });

  it("allows template variables in the URL path (origin unchanged)", async () => {
    const { ctx } = makeContext({
      templateContext: { "user.id": "u-7" },
      flow: apiFlow({ method: "GET", url: "https://api.example.com/users/{{user.id}}" }),
    });
    await ACTION_HANDLERS.api_request(ctx);
    expect(egressFetchMock.mock.calls[0][0]).toBe(
      "https://api.example.com/users/u-7"
    );
  });

  function okJson(text: string) {
    return {
      response: { status: 200, ok: true, headers: new Headers(), text },
      finalUrl: "https://api.example.com/",
    };
  }

  it("extracts JSON-path values into a templatePatch for later actions", async () => {
    egressFetchMock.mockResolvedValueOnce(
      okJson('{"data":{"user":{"name":"Ada"}},"ids":[10,20]}') as never
    );
    const { ctx } = makeContext({
      flow: apiFlow({
        url: "https://api.example.com/",
        jsonPaths: [
          { id: "j1", path: "$.data.user.name", variable: "userName" },
          { id: "j2", path: "$.ids[1]", variable: "secondId" },
        ],
      }),
    });
    const result = await ACTION_HANDLERS.api_request(ctx);
    expect(result.templatePatch).toEqual({ userName: "Ada", secondId: "20" });
  });

  it("binds the whole response body when the path is blank", async () => {
    egressFetchMock.mockResolvedValueOnce(okJson('{"a":1}') as never);
    const { ctx } = makeContext({
      flow: apiFlow({
        url: "https://api.example.com/",
        jsonPaths: [{ id: "j1", path: "", variable: "whole" }],
      }),
    });
    const result = await ACTION_HANDLERS.api_request(ctx);
    expect(result.templatePatch).toEqual({ whole: '{"a":1}' });
  });

  it("yields empty variables (not a failure) on a non-matching path or non-JSON body", async () => {
    egressFetchMock.mockResolvedValueOnce(okJson('{"a":1}') as never);
    const miss = makeContext({
      flow: apiFlow({
        url: "https://api.example.com/",
        jsonPaths: [{ id: "j1", path: "$.nope", variable: "x" }],
      }),
    });
    const missResult = await ACTION_HANDLERS.api_request(miss.ctx);
    expect(missResult.templatePatch).toEqual({ x: "" });
    expect((missResult.parts[0] as { text: string }).text).toMatch(/successfully/i);

    egressFetchMock.mockResolvedValueOnce(okJson("<html>not json</html>") as never);
    const nonJson = makeContext({
      flow: apiFlow({
        url: "https://api.example.com/",
        jsonPaths: [{ id: "j1", path: "$.a", variable: "x" }],
      }),
    });
    const nonJsonResult = await ACTION_HANDLERS.api_request(nonJson.ctx);
    expect(nonJsonResult.templatePatch).toEqual({ x: "" });
    expect((nonJsonResult.parts[0] as { text: string }).text).toMatch(/successfully/i);
  });
});
