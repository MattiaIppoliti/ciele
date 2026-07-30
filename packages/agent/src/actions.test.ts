import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Assistant, Flow, FlowAction, KnowledgeSearchResult } from "@agent-hub/core";
import type { ChatReplyPart } from "./types";
import { simulateReadableStream } from "ai";
import type { LanguageModel } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { ACTION_HANDLERS } from "./actions";
import {
  MAX_AGENT_ITERATIONS,
  MAX_SEARCH_PASSES,
  buildSystemPrompt,
  type TerminalStatus,
} from "./agentic-search";
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
    triggerSettings: {},
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
  "notification",
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

describe("notification", () => {
  const proactive = (
    notification: NonNullable<Flow["actionSettings"]["notification"]>
  ) =>
    makeFlow({
      trigger: "chat_open",
      actions: ["notification"],
      actionSettings: { notification },
    });

  it("emits the configured content verbatim", async () => {
    const { ctx, events } = makeContext({
      flow: proactive({ title: "Exams", content: "Results are out." }),
    });
    const result = await ACTION_HANDLERS.notification(ctx);
    expect(result.parts).toEqual([
      {
        type: "notification",
        action: "notification",
        title: "Exams",
        content: "Results are out.",
      },
    ]);
    expect(events).toEqual([{ type: "part", part: result.parts[0] }]);
  });

  it("omits an absent title rather than emitting an empty one", async () => {
    const { ctx } = makeContext({ flow: proactive({ content: "Just the body." }) });
    const result = await ACTION_HANDLERS.notification(ctx);
    expect(result.parts[0]).toEqual({
      type: "notification",
      action: "notification",
      content: "Just the body.",
    });
  });

  it("stays silent when no content is configured", async () => {
    const { ctx, events } = makeContext({ flow: proactive({ title: "Only a title" }) });
    const result = await ACTION_HANDLERS.notification(ctx);
    expect(result.parts).toEqual([]);
    expect(events).toEqual([]);
  });

  it("marks a one-way nudge, and says nothing when replies are allowed", async () => {
    const closed = makeContext({
      flow: proactive({ content: "Announcement.", allowReplies: false }),
    });
    expect(await ACTION_HANDLERS.notification(closed.ctx)).toMatchObject({
      parts: [{ type: "notification", allowReplies: false }],
    });

    const open = makeContext({
      flow: proactive({ content: "Announcement.", allowReplies: true }),
    });
    const result = await ACTION_HANDLERS.notification(open.ctx);
    expect(result.parts[0]).not.toHaveProperty("allowReplies");
  });

  it("emits its buttons as ordinary button parts", async () => {
    const { ctx } = makeContext({
      flow: proactive({
        content: "Results are out.",
        buttons: [
          { id: "b1", label: "See results", type: "external_link", url: "https://x.test/r" },
          { id: "b2", label: "Explain", type: "send_text", text: "Explain my grade" },
        ],
      }),
    });
    const result = await ACTION_HANDLERS.notification(ctx);
    expect(result.parts.slice(1)).toEqual([
      {
        type: "button",
        action: "notification",
        label: "See results",
        buttonType: "external_link",
        url: "https://x.test/r",
      },
      {
        type: "button",
        action: "notification",
        label: "Explain",
        buttonType: "send_text",
        text: "Explain my grade",
      },
    ]);
  });

  it("drops an incomplete button rather than rendering a dead one", async () => {
    const { ctx } = makeContext({
      flow: proactive({
        content: "Results are out.",
        buttons: [
          { id: "b1", label: "No destination", type: "external_link" },
          { id: "b2", type: "send_text", text: "no label" },
          { id: "b3", label: "Fine", type: "external_link", url: "https://x.test" },
        ],
      }),
    });
    const result = await ACTION_HANDLERS.notification(ctx);
    expect(result.parts).toHaveLength(2);
    expect(result.parts[1]).toMatchObject({ label: "Fine" });
  });

  it("resolves template variables in title and content", async () => {
    const { ctx } = makeContext({
      flow: proactive({ title: "Hi {{user.name}}", content: "Welcome, {{user.name}}." }),
      templateContext: { "user.name": "Ada" },
    });
    const result = await ACTION_HANDLERS.notification(ctx);
    expect(result.parts[0]).toEqual({
      type: "notification",
      action: "notification",
      title: "Hi Ada",
      content: "Welcome, Ada.",
    });
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
    // The style only appears in the WRITE phase — see the late-binding block
    // below for why it is absent while the model is choosing tools.
    const prompt = buildSystemPrompt(
      "PLATFORM RULES",
      makeAssistant({ answeringStyle: "Always answer in haiku." }),
      makeFlow({ name: "Default behavior" }),
      { phase: "write" }
    );
    const platformIdx = prompt.indexOf("PLATFORM RULES");
    const styleIdx = prompt.indexOf("Always answer in haiku.");
    const flowIdx = prompt.indexOf("Default behavior");
    expect(platformIdx).toBeGreaterThanOrEqual(0);
    expect(styleIdx).toBeGreaterThan(platformIdx);
    expect(flowIdx).toBeGreaterThan(styleIdx);
    expect(prompt).toContain("immutable — highest precedence");
  });

  it("late-binds the answering style: absent while gathering, present when writing", () => {
    // #558: in the gather phase the style would compete with tool-selection
    // reasoning for the whole loop, so it rides the terminal tool's result
    // instead and only enters the prompt once the model is actually writing.
    const assistant = makeAssistant({ answeringStyle: "Always answer in haiku." });
    const gather = buildSystemPrompt("P", assistant, makeFlow(), {
      phase: "gather",
    });
    expect(gather).not.toContain("Always answer in haiku.");
    expect(gather).toContain("you are in the FIRST one");
    expect(gather).toContain("readyToAnswer exactly once");
    // The gather phase must not let the model address the user at all.
    expect(gather).toContain("Do NOT write anything addressed to the user");

    const write = buildSystemPrompt("P", assistant, makeFlow(), {
      phase: "write",
    });
    expect(write).toContain("Always answer in haiku.");
    expect(write).toContain("SECOND phase");
    expect(write).toContain("no tools now");
  });

  it("defaults to the gather phase", () => {
    const prompt = buildSystemPrompt(
      "P",
      makeAssistant({ answeringStyle: "Always answer in haiku." }),
      makeFlow()
    );
    expect(prompt).not.toContain("Always answer in haiku.");
    expect(prompt).toContain("you are in the FIRST one");
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
        phase: "write",
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
      {
        phase: "write",
        flowStyle: { answeringStyle: "Keep it under two sentences." },
      }
    );
    expect(prompt).toContain("Always answer in haiku.");
    expect(prompt).toContain("Additional instructions for this flow");
    expect(prompt).toContain("Keep it under two sentences.");
  });

  it("replaces the org answering style when the flow overrides it", () => {
    const prompt = buildSystemPrompt(
      "P",
      makeAssistant({ answeringStyle: "Always answer in haiku." }),
      makeFlow(),
      {
        phase: "write",
        flowStyle: {
          answeringStyle: "Reply only in formal French.",
          overrideAnsweringStyle: true,
        },
      }
    );
    expect(prompt).toContain("Reply only in formal French.");
    expect(prompt).not.toContain("Always answer in haiku.");
    expect(prompt).not.toContain("Additional instructions for this flow");
  });

  it("adds flow search guidelines to the routing context", () => {
    const prompt = buildSystemPrompt("P", makeAssistant(), makeFlow(), {
      flowStyle: { searchGuidelines: "Also search related deadlines." },
    });
    expect(prompt).toContain("Search guidelines for this flow");
    expect(prompt).toContain("Also search related deadlines.");
  });
});

/**
 * The two-phase turn's model fixtures (#558). A turn is now TWO generative
 * calls: phase 1 gathers and must end by calling `readyToAnswer`, phase 2 writes
 * with no tools. So a fixture is a SCRIPT of steps, and each step has to hand
 * back a fresh stream — `simulateReadableStream` yields a single-use stream, and
 * a fixture that reuses one silently gives phase 2 an already-consumed body.
 */
const phaseUsage = () => ({
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
});

/** Phase 1's mandatory ending: the model declares what it found. */
function declareStep(status: TerminalStatus = "answer") {
  return () => ({
    stream: simulateReadableStream({
      chunks: [
        { type: "stream-start" as const, warnings: [] },
        {
          type: "tool-call" as const,
          toolCallId: `ready-${status}`,
          toolName: "readyToAnswer",
          input: JSON.stringify({ status }),
        },
        {
          type: "finish" as const,
          finishReason: { unified: "tool-calls" as const, raw: "tool_calls" },
          usage: phaseUsage(),
        },
      ],
    }),
  });
}

/** Phase 2: the write. Deltas may be empty — that is the cut-off-before-writing case. */
function writeStep(
  deltas: string[] = [],
  unified: "stop" | "length" | "content-filter" = "stop",
  raw?: string
) {
  return () => ({
    stream: simulateReadableStream({
      chunks: [
        { type: "stream-start" as const, warnings: [] },
        { type: "text-start" as const, id: "1" },
        ...deltas.map((delta) => ({
          type: "text-delta" as const,
          id: "1",
          delta,
        })),
        { type: "text-end" as const, id: "1" },
        {
          type: "finish" as const,
          finishReason: { unified, raw: raw ?? unified },
          usage: phaseUsage(),
        },
      ],
    }),
  });
}

/**
 * Runs the scripted steps in order; the last one repeats if the loop asks for
 * more. The one cast is at the mock boundary: each step's stream is typed from
 * its own chunk list, so the union does not unify with the SDK's part type.
 */
type ScriptedStep = () => { stream: unknown };

function scriptedModel(...steps: ScriptedStep[]) {
  let call = 0;
  return new MockLanguageModelV3({
    doStream: async () => steps[Math.min(call++, steps.length - 1)]() as any,
  });
}

describe("search_knowledge finish reasons (refusal & truncation)", () => {
  /** A phase-1 model that refuses instead of gathering. */
  const refusingModel = () =>
    scriptedModel(writeStep([], "content-filter", "refusal"));

  it("answers a refusal honestly with the escalation offer (no retry)", async () => {
    const model = refusingModel();
    const { ctx } = makeContext({ chatModel: model as unknown as LanguageModel });
    const result = await ACTION_HANDLERS.search_knowledge(ctx);

    expect(result.parts.map((p) => p.type)).toEqual(["text", "help_desk"]);
    const text = (result.parts[0] as { action: string; text: string });
    expect(text.action).toBe("refusal");
    expect(text.text).toContain("can't help with that request");
    // Never dressed up as a knowledge gap, no provider internals on the widget.
    expect(text.text).not.toContain("knowledge base");
    expect(text.text).not.toContain("refusal");
    // Exactly one generative invocation: a refusal while gathering is terminal,
    // so the write phase never runs — and refusals are not shopped around.
    expect(model.doStreamCalls).toHaveLength(1);
  });

  it("shows the raw finish reason only on the preview surface", async () => {
    const model = refusingModel();
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
    // Truncation is a WRITE-phase concern now: a gather cut short still gets to
    // write, but an answer cut short has to say so.
    const model = scriptedModel(declareStep(), writeStep(["Partial ans"], "length"));
    const { ctx } = makeContext({ chatModel: model as unknown as LanguageModel });
    const result = await ACTION_HANDLERS.search_knowledge(ctx);

    expect(result.parts.map((p) => p.type)).toEqual(["text", "text"]);
    expect((result.parts[0] as { text: string }).text).toBe("Partial ans");
    expect((result.parts[1] as { text: string }).text).toContain("cut short");
    // Truncation offers no escalation push.
    expect(result.parts.some((p) => p.type === "help_desk")).toBe(false);
  });

  it("keeps the normal path unchanged and meters BOTH phases", async () => {
    const model = scriptedModel(declareStep(), writeStep(["All good."]));
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
    // Two generative calls, two ledger entries. The two-phase turn genuinely
    // costs two model calls and the AI usage ledger must show that rather than
    // quietly under-reporting what the org is billed for.
    expect(model.doStreamCalls).toHaveLength(2);
    expect(usage).toEqual([
      { inputTokens: 10, outputTokens: 5 },
      { inputTokens: 10, outputTokens: 5 },
    ]);
  });

  it("never writes to the user without a terminal declaration", async () => {
    // Phase 1 prose is private reasoning, not an answer: a model that tries to
    // reply during the gather phase has its text folded into the Thinking panel
    // and the real reply still comes from phase 2.
    const model = scriptedModel(
      writeStep(["Let me just answer directly."]),
      writeStep(["The deadline is 30 September."])
    );
    const events: RuntimeEvent[] = [];
    const { ctx } = makeContext({
      chatModel: model as unknown as LanguageModel,
      emit: (e) => events.push(e),
    });
    const result = await ACTION_HANDLERS.search_knowledge(ctx);

    expect(events.some((e) => e.type === "thought")).toBe(true);
    expect(
      events.find((e) => e.type === "thought")
    ).toMatchObject({ text: "Let me just answer directly." });
    expect((result.parts[0] as { text: string }).text).toBe(
      "The deadline is 30 September."
    );
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
    const model = scriptedModel(
      declareStep("insufficient_information"),
      writeStep(["I could not verify that."])
    );
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

  it("caps a keeps-finding-nothing turn at the iteration budget, then still writes", async () => {
    let seq = 0;
    // Always asks to search again with a fresh query — the budget, not the
    // model, must terminate the gather phase. Then the write phase runs with
    // nothing to write from, which is the honest dead-end path.
    let gatherCalls = 0;
    const model = new MockLanguageModelV3({
      doStream: async () => {
        // Phase 1 keeps searching until a gate stops it; phase 2 has no tools,
        // so it is scripted separately as an empty write.
        if (gatherCalls++ < MAX_AGENT_ITERATIONS) {
          return searchStep(`call-${++seq}`, `attempt ${seq}`);
        }
        return writeStep()();
      },
    });
    const searchKnowledge = vi.fn(async () => [] as KnowledgeSearchResult[]);
    const { ctx } = makeContext({
      chatModel: model as unknown as LanguageModel,
      searchKnowledge,
      message: "something not in the knowledge base",
    });

    const result = await ACTION_HANDLERS.search_knowledge(ctx);

    // The ITERATION budget ends it — one search per iteration here, so six —
    // and the retrieval ceiling underneath is never reached.
    expect(searchKnowledge).toHaveBeenCalledTimes(MAX_AGENT_ITERATIONS);
    expect(MAX_AGENT_ITERATIONS).toBeLessThan(MAX_SEARCH_PASSES);

    // A single text part — never a bare empty bubble, even when the model wrote
    // nothing at all.
    const textParts = result.parts.filter(
      (p): p is Extract<ChatReplyPart, { type: "text" }> => p.type === "text"
    );
    expect(textParts).toHaveLength(1);
    expect(textParts[0].text).toContain("couldn't find");
    // Nothing grounded it, so no Sources part.
    expect(result.parts.some((p) => p.type === "sources")).toBe(false);
  });

  it("a gather that never declares still writes, under the grounding-derived status", async () => {
    // The declaration is mandatory, but a budget that runs out mid-gather cannot
    // be allowed to produce silence: the status falls back to what the grounding
    // actually supports.
    let gatherCalls = 0;
    const model = new MockLanguageModelV3({
      doStream: async () => {
        if (gatherCalls++ < MAX_AGENT_ITERATIONS) {
          return searchStep(`c-${gatherCalls}`, `attempt ${gatherCalls}`);
        }
        return writeStep(["Here is what I found."])();
      },
    });
    const searchKnowledge = vi.fn(async () => [strongResult]);
    const { ctx } = makeContext({
      chatModel: model as unknown as LanguageModel,
      searchKnowledge,
      message: "when does enrollment close?",
    });

    const result = await ACTION_HANDLERS.search_knowledge(ctx);
    expect((result.parts[0] as { text: string }).text).toBe(
      "Here is what I found."
    );
    // Sources were found, so the fallback status is `answer` and provenance
    // still ships.
    expect(result.parts.some((p) => p.type === "sources")).toBe(true);
  });

  it("asks one question when the model declares it needs clarification", async () => {
    const model = scriptedModel(
      declareStep("needs_clarification"),
      writeStep(["Which intake year do you mean?"])
    );
    const events: RuntimeEvent[] = [];
    const { ctx } = makeContext({
      chatModel: model as unknown as LanguageModel,
      message: "when does it close?",
      emit: (e) => events.push(e),
    });

    const result = await ACTION_HANDLERS.search_knowledge(ctx);

    // Rendered as a clarify part, not prose — and collected rather than
    // streamed, so the Visitor never watches a half-question appear.
    expect(result.parts).toHaveLength(1);
    expect(result.parts[0]).toMatchObject({
      type: "clarify",
      question: "Which intake year do you mean?",
    });
    expect(events.some((e) => e.type === "text-delta")).toBe(false);
  });

  it("never clarifies twice in one conversation, even when the model asks to", async () => {
    // The anti-loop guarantee: being asked to rephrase a second time reads as
    // the assistant refusing to try, so the declaration is coerced to a
    // best-effort answer and the write-time instructions say why.
    const model = scriptedModel(
      declareStep("needs_clarification"),
      writeStep(["I could not pin down the year, but here is what I have."])
    );
    const { ctx } = makeContext({
      chatModel: model as unknown as LanguageModel,
      message: "when does it close?",
      alreadyClarified: true,
    });

    const result = await ACTION_HANDLERS.search_knowledge(ctx);

    expect(result.parts.some((p) => p.type === "clarify")).toBe(false);
    expect(result.parts[0]).toMatchObject({
      type: "text",
      action: "search_knowledge",
    });
    expect((result.parts[0] as { text: string }).text).toContain(
      "could not pin down"
    );
  });

  it("stops as soon as a pass grounds the answer and still emits a deduped Sources part", async () => {
    const model = scriptedModel(
      () => searchStep("call-1", "when does enrollment close"),
      declareStep(),
      writeStep(["Enrollment closes on 30 September."])
    );
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
