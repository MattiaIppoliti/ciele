import { afterEach, describe, expect, it, vi } from "vitest";
import { Experimental_EvaluationMockModelV4, MockLanguageModelV3 } from "ai/test";
import type { Assistant, Flow } from "@agent-hub/core";
import { PREFLIGHT_MODEL_ID, THINKING_LINES } from "@agent-hub/core";
import { runAssistantChat } from "./engine";
import type { RuntimeEvent } from "./types";
import { registerRuntimeHost, resetRuntimeHost } from "./host";
import { createTurnSession } from "./session";
import type { ResolvedDecisionModel } from "./decision-model";
import type { ActionContext } from "./types";

/**
 * The shadow pre-flight at the turn seam (#952).
 *
 * The acceptance criteria are all properties of a turn, not of the decision, so
 * they are asserted here: with the flag on the turn takes the Flow it would
 * have taken anyway, with the flag off nothing is asked and nothing is billed,
 * and the two messages that must never ask, courtesy and a resumed Flow, do not.
 *
 * Every test runs with no chat model at all, so Intent Classification falls to
 * the deterministic keyword matcher. That is the point: the Flow is then a
 * fact, and "the flag changed nothing" is an equality rather than a comparison
 * of two model calls.
 */

// Every action answers one neutral text part. Not an empty list: a Flow whose
// actions produce nothing gets the engine's "matched, but it has no actions"
// fallback, which names the Flow, and the leak tests below are about what the
// pre-flight path emits, not about that pre-existing copy.
vi.mock("./actions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./actions")>()),
  ACTION_HANDLERS: new Proxy(
    {},
    {
      get: () => async (_ctx: ActionContext) => {
        decisionModel.actionsRun += 1;
        return { parts: [{ type: "text", action: "custom_message", text: "ok" }] };
      },
      has: () => true,
    }
  ),
}));

const decisionModel = vi.hoisted(() => ({
  resolved: null as ResolvedDecisionModel | null,
  asked: 0,
  /** Flow actions dispatched this test: an FAQ direct hit dispatches none. */
  actionsRun: 0,
  /** The FAQ options the last decision was asked over. */
  faqOptions: [] as string[],
  recommendationsAsked: 0,
  /** Classifier model streams opened this test; the routed turns must open none. */
  classifierCalls: 0,
  /** When true, `getClassifierModel` hands the engine a counting model instead of null. */
  countingClassifier: false,
}));

/**
 * The "AI recommended help desk" call (#955): counted, never run. With routing
 * on and a confident "wants a human", the pre-flight's desk *is* the
 * recommendation and this must not be asked.
 */
vi.mock("./help-desk-recommend", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./help-desk-recommend")>();
  return {
    ...actual,
    buildHelpDeskRecommender: () => () => {
      decisionModel.recommendationsAsked += 1;
      return Promise.resolve(null);
    },
  };
});

vi.mock("./decision-model", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./decision-model")>();
  return { ...actual, resolveDecisionModel: () => decisionModel.resolved };
});

/**
 * A chat model has to resolve, or the engine takes the deterministic demo
 * branch (ADR-0003) and never classifies at all. The classifier itself stays
 * null on purpose: `classifyIntent` then falls to the keyword matcher, so the
 * Flow each test asserts is a fact rather than a second scripted model.
 */
vi.mock("./models", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./models")>();
  return {
    ...actual,
    resolveChatModel: () => ({
      model: new MockLanguageModelV3({}),
      provider: "anthropic",
      modelId: "claude-opus-4-8",
      credentialKind: "platform",
    }),
    getClassifierModel: () =>
      decisionModel.countingClassifier
        ? {
            model: new MockLanguageModelV3({
              doStream: async () => {
                decisionModel.classifierCalls += 1;
                // Throwing sends classifyIntent to the keyword matcher, so the
                // Flow stays a fact while the call itself is counted.
                throw new Error("counted");
              },
            }),
            provider: "anthropic",
            modelId: "claude-haiku-4-5-20251001",
            credentialKind: "platform",
          }
        : null,
  };
});

/**
 * What the scripted model says, per question: the option and the confidence
 * Jev would report for it. Unscripted questions take their exit (`none`) or
 * the first option at full confidence, so a test names only what it is about.
 */
interface Script {
  flow?: [choice: string, confidence: number];
  faq?: [choice: string, confidence: number];
  wantsHuman?: number;
  desk?: [choice: string, confidence: number];
  language?: [choice: string, confidence: number];
  calibrated?: boolean;
}

function answeringModel(script: Script = {}): ResolvedDecisionModel {
  const scripted: Record<string, [string, number] | undefined> = {
    flow: script.flow,
    faq: script.faq,
    desk: script.desk,
    language: script.language,
  };
  return {
    model: new Experimental_EvaluationMockModelV4({
      modelId: PREFLIGHT_MODEL_ID,
      doEvaluate: async ({ questions }) => {
        decisionModel.asked += 1;
        const faq = questions.faq;
        decisionModel.faqOptions = faq && faq.type === "choice" ? Object.keys(faq.criteria) : [];
        const confidence: Record<string, number> = {};
        return {
          answers: Object.fromEntries(
            Object.entries(questions).map(([id, question]) => {
              if (question.type === "boolean") {
                return [id, { type: "boolean", probability: script.wantsHuman ?? 0.1 }];
              }
              if (question.type === "score") {
                const levels = question.criteria.length;
                return [
                  id,
                  {
                    type: "score",
                    score: 0,
                    probabilities: Object.fromEntries(
                      Array.from({ length: levels }, (_, i) => [String(i), i === 0 ? 1 : 0])
                    ),
                  },
                ];
              }
              const options = Object.keys(question.criteria);
              // Unscripted: the exit for the two questions that have one, so a
              // test about Flows is not also, silently, an FAQ direct hit.
              const exit = options.includes("none") ? "none" : options[0];
              const [choice, sure] = scripted[id] ?? [exit, 1];
              if (!options.includes(choice)) throw new Error(`script names "${choice}", not an option of ${id}`);
              confidence[id] = sure;
              return [
                id,
                {
                  type: "choice",
                  choice,
                  probabilities: Object.fromEntries(
                    options.map((option) => [option, option === choice ? 1 : 0])
                  ),
                },
              ];
            })
          ),
          rounding: { probabilityDecimals: 2, scoreDecimals: 2 },
          usage: { inputTokens: 300, outputTokens: 20 },
          providerMetadata: { typesafe: { confidence } },
          warnings: [],
        };
      },
    }),
    backend: "jev",
    provider: "typesafe",
    modelId: "typesafe-ai/jev",
    credentialKind: "platform",
    calibrated: script.calibrated ?? true,
  };
}

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

const defaultFlow = makeFlow({
  id: "default",
  name: "Default behavior",
  isDefault: true,
  position: 9,
  actions: ["search_knowledge"],
});

const courtesyFlow = makeFlow({
  id: "basic",
  name: "Basic Interaction",
  builtIn: true,
  position: -1,
  actions: ["basic_reply"],
});

function makeAssistant(): Assistant {
  return {
    id: "assistant-1",
    organizationId: "org-1",
    title: "Assistant",
    nickname: "Assistant",
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
    simplifiedThinking: false,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  } as Assistant;
}

type RunOptions = Parameters<typeof runAssistantChat>[0];

async function run(options: {
  message: string;
  flows?: Flow[];
  visitorLocale?: string | null;
  faqs?: { id: string; question: string }[];
  readPreflightFaq?: RunOptions["readPreflightFaq"];
  searchKnowledge?: RunOptions["searchKnowledge"];
  desks?: { id: string; name: string; description: string }[];
}) {
  let loaded = 0;
  const events: RuntimeEvent[] = [];
  const result = await runAssistantChat({
    assistant: makeAssistant(),
    flows: options.flows ?? [courtesyFlow, defaultFlow],
    connections: [],
    message: options.message,
    history: [],
    session: createTurnSession("conv-1", {}),
    loadPreflightCatalogue: async () => {
      loaded += 1;
      return {
        faqs: options.faqs ?? [{ id: "faq-1", question: "How do I reset my password?" }],
        desks: options.desks ?? [],
      };
    },
    visitorLocale: options.visitorLocale,
    readPreflightFaq: options.readPreflightFaq,
    searchKnowledge: options.searchKnowledge,
    emit: (event) => {
      events.push(event);
    },
  });
  return { result, loaded, events };
}

afterEach(() => {
  resetRuntimeHost();
  decisionModel.resolved = null;
  decisionModel.asked = 0;
  decisionModel.actionsRun = 0;
  decisionModel.faqOptions = [];
  decisionModel.recommendationsAsked = 0;
  decisionModel.classifierCalls = 0;
  decisionModel.countingClassifier = false;
});

describe("the shadow pre-flight at the turn seam", () => {
  it("asks nothing and bills nothing with the flag off", async () => {
    decisionModel.resolved = answeringModel();
    const { result, loaded } = await run({ message: "how do I reset my password" });

    expect(decisionModel.asked).toBe(0);
    expect(loaded).toBe(0);
    expect(result.usage.some((event) => event.stage === "decide")).toBe(false);
    expect(result.preflight).toBeUndefined();
  });

  it("takes the same Flow with the flag on as with it off, and records the pair", async () => {
    const off = await run({ message: "how do I reset my password" });

    registerRuntimeHost({ preflightShadowEnabled: () => true });
    decisionModel.resolved = answeringModel();
    const on = await run({ message: "how do I reset my password" });

    // The criterion: the flag changes what is recorded, never what is routed.
    expect(on.result.flowId).toBe(off.result.flowId);
    expect(on.result.flowName).toBe(off.result.flowName);
    expect(decisionModel.asked).toBe(1);
    expect(on.loaded).toBe(1);
    expect(on.result.preflight?.routedFlowId).toBe(off.result.flowId);
    expect(on.result.usage.some((event) => event.stage === "decide")).toBe(true);
  });

  it("never asks about a courtesy message", async () => {
    registerRuntimeHost({ preflightShadowEnabled: () => true });
    decisionModel.resolved = answeringModel();
    const { result, loaded } = await run({ message: "grazie!" });

    // Basic Interaction's whole promise is that it spends nothing; a decision
    // call here would contradict the feature it sits beside.
    expect(result.flowId).toBe("basic");
    expect(decisionModel.asked).toBe(0);
    expect(loaded).toBe(0);
    expect(result.preflight).toBeUndefined();
  });

  it("completes the turn when the backend never answers", async () => {
    registerRuntimeHost({ preflightShadowEnabled: () => true });
    decisionModel.resolved = {
      ...answeringModel(),
      model: new Experimental_EvaluationMockModelV4({
        modelId: PREFLIGHT_MODEL_ID,
        doEvaluate: () => new Promise(() => {}),
      }),
    };
    const { result } = await run({ message: "how do I reset my password" });

    // The same Flow the test above pins as this message's, reached while the
    // decision was still hanging: one budget's wait, then today's path.
    expect(result.flowId).toBe("default");
    expect(result.preflight?.failure?.reason).toBe("timeout");
    expect(result.usage.some((event) => event.stage === "decide")).toBe(false);
  }, 20_000);
});

/**
 * The pre-flight routing at the turn seam (#953). A Flow whose name would be
 * recognisable if it leaked is the catalogue throughout, because the criterion
 * that matters most is the one about what a Visitor's screen never shows.
 */
const passwordFlow = makeFlow({
  id: "flow-password",
  name: "Hostile Password Reset Flow",
  description: "The visitor cannot sign in or lost a password.",
  position: 1,
  actions: ["search_knowledge"],
});
const verbatimFlow = makeFlow({
  id: "flow-verbatim",
  name: "Refund Verbatim Flow",
  description: "Refund questions.",
  position: 2,
  actions: ["custom_message"],
  customMessage: "Refunds take five days.",
});
const routingFlows = [courtesyFlow, passwordFlow, verbatimFlow, defaultFlow];

const leaks = (events: RuntimeEvent[], name: string): boolean =>
  events.some((event) => JSON.stringify(event).toLowerCase().includes(name.toLowerCase()));

describe("the pre-flight routing at the turn seam", () => {
  it("takes the Flow the decision cleared, with no classification call and the fixed Thinking line", async () => {
    registerRuntimeHost({ preflightRoutingEnabled: () => true });
    decisionModel.resolved = answeringModel({ flow: ["flow-password", 0.95], language: ["it", 0.99] });
    const { result, events } = await run({ message: "non riesco ad accedere al portale", flows: routingFlows });

    expect(result.flowId).toBe("flow-password");
    expect(decisionModel.asked).toBe(1);
    expect(result.preflight).toMatchObject({ backend: "jev", acted: true, routedFlowId: "flow-password" });
    // No classification ran: its notice is the one thing that would say it had.
    expect(events.some((e) => e.type === "notice" && e.label === "Classifying intent")).toBe(false);
    // The first thing on the panel is the table's sentence, in the message's language.
    const thought = events.find((e) => e.type === "thought");
    expect(thought).toEqual({ type: "thought", text: THINKING_LINES.it.knowledge_search });
    // Nothing that reaches a client names the Flow.
    const leaked = events.filter((e) => e.type !== "flow" && JSON.stringify(e).toLowerCase().includes(passwordFlow.name.toLowerCase()));
    expect(leaked).toEqual([]);
  });

  it("opens no classifier stream when it routes, and one when it does not", async () => {
    registerRuntimeHost({ preflightRoutingEnabled: () => true });
    decisionModel.countingClassifier = true;
    decisionModel.resolved = answeringModel({ flow: ["flow-password", 0.95] });
    const routed = await run({ message: "non riesco ad accedere", flows: routingFlows });
    expect(routed.result.flowId).toBe("flow-password");
    expect(decisionModel.classifierCalls).toBe(0);

    decisionModel.resolved = answeringModel({ flow: ["flow-password", 0.5] });
    await run({ message: "non riesco ad accedere", flows: routingFlows });
    expect(decisionModel.classifierCalls).toBe(1);
  });

  it("falls back to the chat locale for the line, and to English past that", async () => {
    registerRuntimeHost({ preflightRoutingEnabled: () => true });
    decisionModel.resolved = answeringModel({ flow: ["flow-password", 0.95], language: ["mixed", 0.9] });
    const fr = await run({ message: "help, non riesco", flows: routingFlows, visitorLocale: "fr-FR" });
    expect(fr.events.find((e) => e.type === "thought")).toEqual({ type: "thought", text: THINKING_LINES.fr.knowledge_search });

    decisionModel.resolved = answeringModel({ flow: ["flow-password", 0.95], language: ["mixed", 0.9] });
    const none = await run({ message: "help, non riesco", flows: routingFlows, visitorLocale: null });
    expect(none.events.find((e) => e.type === "thought")).toEqual({ type: "thought", text: THINKING_LINES.en.knowledge_search });
  });

  it("puts no line on the panel for a verbatim Flow, whose reply is the next thing on screen", async () => {
    registerRuntimeHost({ preflightRoutingEnabled: () => true });
    decisionModel.resolved = answeringModel({ flow: ["flow-verbatim", 0.9] });
    const { result, events } = await run({ message: "how do refunds work", flows: routingFlows });

    expect(result.flowId).toBe("flow-verbatim");
    expect(events.some((e) => e.type === "thought")).toBe(false);
    expect(leaks(events.filter((e) => e.type !== "flow"), verbatimFlow.name)).toBe(false);
  });

  it("sends a confident 'default' to the Default behavior Flow as knowledge search", async () => {
    registerRuntimeHost({ preflightRoutingEnabled: () => true });
    decisionModel.resolved = answeringModel({ flow: ["default", 0.92], language: ["en", 0.99] });
    const { result, events } = await run({ message: "when is the deadline?", flows: routingFlows });

    expect(result.flowId).toBe("default");
    expect(result.preflight?.acted).toBe(true);
    expect(events.find((e) => e.type === "thought")).toEqual({ type: "thought", text: THINKING_LINES.en.knowledge_search });
  });

  it("is today's turn, event for event, below the threshold", async () => {
    const off = await run({ message: "how do I reset my password", flows: routingFlows });

    registerRuntimeHost({ preflightRoutingEnabled: () => true });
    decisionModel.resolved = answeringModel({ flow: ["flow-password", 0.5] });
    const on = await run({ message: "how do I reset my password", flows: routingFlows });

    expect(on.events).toEqual(off.events);
    expect(on.result.flowId).toBe(off.result.flowId);
    expect(on.result.preflight).toMatchObject({ routedFlowId: off.result.flowId });
    expect(on.result.preflight?.acted).toBeUndefined();
    expect(on.result.preflight?.wouldRoute).toEqual({ kind: "fallback", reason: "under_threshold" });
  });

  it("is today's turn, event for event, under an uncalibrated backend", async () => {
    const off = await run({ message: "how do I reset my password", flows: routingFlows });

    registerRuntimeHost({ preflightRoutingEnabled: () => true });
    decisionModel.resolved = { ...answeringModel({ flow: ["flow-password", 0.99], calibrated: false }), backend: "adapter" };
    const on = await run({ message: "how do I reset my password", flows: routingFlows });

    expect(on.events).toEqual(off.events);
    expect(on.result.preflight?.wouldRoute).toEqual({ kind: "fallback", reason: "uncalibrated" });
    expect(on.result.preflight?.acted).toBeUndefined();
  });

  it("leaves a Flow disabled since the catalogue read to classification", async () => {
    registerRuntimeHost({ preflightRoutingEnabled: () => true });
    decisionModel.resolved = answeringModel({ flow: ["flow-password", 0.95] });
    const flows = routingFlows.map((f) => (f.id === "flow-password" ? { ...f, enabled: false } : f));
    const { result } = await run({ message: "non riesco ad accedere", flows });

    expect(result.flowId).not.toBe("flow-password");
    expect(result.preflight?.acted).toBeUndefined();
  });

  it("asks with routing on even when the shadow flag is off, and never on a courtesy message", async () => {
    registerRuntimeHost({ preflightRoutingEnabled: () => true, preflightShadowEnabled: () => false });
    decisionModel.resolved = answeringModel({ flow: ["flow-password", 0.95] });
    await run({ message: "non riesco ad accedere", flows: routingFlows });
    expect(decisionModel.asked).toBe(1);

    const { result } = await run({ message: "grazie!", flows: routingFlows });
    expect(result.flowId).toBe("basic");
    expect(decisionModel.asked).toBe(1);
  });
});

/**
 * The FAQ direct hit at the turn seam (#954): the curated answer verbatim,
 * cited to the FAQ, with no Flow action dispatched and therefore no retrieval
 * and no generation; below threshold, or with the FAQ gone, today's path.
 */
const storedFaq = {
  body: "Apri Il mio account → Sicurezza → Reimposta password.",
  title: "Come recupero la password?",
  collectionName: "Supporto",
  url: null,
};

describe("the FAQ direct hit at the turn seam", () => {
  it("answers with the stored FAQ verbatim, cited, with no action dispatched", async () => {
    registerRuntimeHost({ preflightRoutingEnabled: () => true });
    decisionModel.resolved = answeringModel({ faq: ["faq-1", 0.93], flow: ["flow-password", 0.9], language: ["it", 0.99] });
    const reads: string[] = [];
    const { result, events } = await run({
      message: "come recupero la password?",
      flows: routingFlows,
      readPreflightFaq: async (id) => {
        reads.push(id);
        return storedFaq;
      },
    });

    expect(reads).toEqual(["faq-1"]);
    expect(result.flowName).toBe("FAQ");
    expect(result.flowId).toBeNull();
    expect(result.parts).toEqual([
      { type: "text", action: "custom_message", text: storedFaq.body },
      {
        type: "sources",
        action: "search_knowledge",
        sources: [{ conceptId: "faq-1", conceptTitle: storedFaq.title, collectionName: "Supporto", sourceName: null, url: null }],
      },
    ]);
    expect(decisionModel.actionsRun).toBe(0);
    expect(decisionModel.asked).toBe(1);
    expect(result.preflight).toMatchObject({ acted: true, routedFlowId: null, wouldRoute: { kind: "faq", faqId: "faq-1" } });
    expect(events.find((e) => e.type === "thought")).toEqual({ type: "thought", text: THINKING_LINES.it.faq });
    expect(events.find((e) => e.type === "flow")).toEqual({ type: "flow", flowId: null, flowName: "FAQ", isDefault: false });
    expect(events.some((e) => e.type === "notice" && e.label === "Classifying intent")).toBe(false);
  });

  it("takes today's path below the FAQ threshold, with no FAQ part", async () => {
    registerRuntimeHost({ preflightRoutingEnabled: () => true });
    decisionModel.resolved = answeringModel({ faq: ["faq-1", 0.6], flow: ["flow-password", 0.5] });
    const { result, events } = await run({
      message: "how do I reset my password",
      flows: routingFlows,
      readPreflightFaq: async () => storedFaq,
    });

    expect(result.flowName).not.toBe("FAQ");
    expect(result.parts.some((p) => p.type === "text" && p.text === storedFaq.body)).toBe(false);
    expect(events.some((e) => e.type === "notice" && e.label === "Classifying intent")).toBe(true);
    expect(result.preflight?.acted).toBeUndefined();
  });

  it("falls to today's path when the FAQ is gone since the catalogue read", async () => {
    registerRuntimeHost({ preflightRoutingEnabled: () => true });
    decisionModel.resolved = answeringModel({ faq: ["faq-1", 0.95] });
    const { result } = await run({ message: "how do I reset my password", flows: routingFlows, readPreflightFaq: async () => null });

    expect(result.flowName).not.toBe("FAQ");
    expect(result.preflight?.acted).toBeUndefined();
  });

  it("still decides over a catalogue past the option cap, shortlisted by similarity", async () => {
    registerRuntimeHost({ preflightRoutingEnabled: () => true });
    const faqs = Array.from({ length: 300 }, (_, i) => ({ id: `faq-${i}`, question: `Question ${i}?` }));
    // The right FAQ sits past the prefix; only the ranking can bring it in.
    decisionModel.resolved = answeringModel({ faq: ["faq-299", 0.95], language: ["en", 0.99] });
    const { result } = await run({
      message: "question two hundred ninety-nine",
      flows: routingFlows,
      faqs,
      searchKnowledge: async () =>
        ["faq-299", "not-an-faq", "faq-250"].map((conceptId, i) => ({
          conceptId,
          conceptTitle: conceptId,
          conceptPath: conceptId,
          collectionId: "c",
          collectionName: "Supporto",
          sourceName: null,
          resourceUrl: null,
          content: "",
          similarity: 1 - i / 10,
        })),
      readPreflightFaq: async (id) => ({ ...storedFaq, title: `Answer ${id}` }),
    });

    // 254 FAQs plus the exit: the cap, with the ranked two first and nothing that is not an FAQ.
    expect(decisionModel.faqOptions).toHaveLength(255);
    expect(decisionModel.faqOptions.slice(0, 2)).toEqual(["faq-299", "faq-250"]);
    expect(decisionModel.faqOptions).not.toContain("not-an-faq");
    expect(result.flowName).toBe("FAQ");
    expect(result.preflight?.faqCatalogue).toEqual({ total: 300, offered: 254, ranked: true });
    expect(result.parts[1]).toMatchObject({ type: "sources", sources: [{ conceptId: "faq-299", conceptTitle: "Answer faq-299" }] });
  });
});

/**
 * Escalation from the pre-flight (#955): a confident "wants a human" is the
 * chip, opened on the desk the decision chose when that choice cleared its own
 * threshold; the separate recommendation call is never made.
 */
const desks = [
  { id: "desk-it", name: "IT desk", description: "Accounts and passwords." },
  { id: "desk-billing", name: "Billing", description: "Invoices and refunds." },
];

describe("escalation from the pre-flight at the turn seam", () => {
  it("opens the chip on the chosen desk, with no recommendation call and nothing else run", async () => {
    registerRuntimeHost({ preflightRoutingEnabled: () => true });
    decisionModel.resolved = answeringModel({ wantsHuman: 0.97, desk: ["desk-it", 0.9], flow: ["flow-password", 0.9], language: ["it", 0.99] });
    const { result, events } = await run({ message: "non riesco ad accedere, con chi posso parlare?", flows: routingFlows, desks });

    expect(result.flowName).toBe("Escalation");
    expect(result.parts).toEqual([{ type: "help_desk", action: "suggest_help_desk", label: "Contact support", helpDeskId: "desk-it" }]);
    expect(decisionModel.recommendationsAsked).toBe(0);
    expect(decisionModel.actionsRun).toBe(0);
    expect(events.find((e) => e.type === "thought")).toEqual({ type: "thought", text: THINKING_LINES.it.escalation });
    expect(events.some((e) => e.type === "notice" && e.label === "Classifying intent")).toBe(false);
    expect(result.preflight).toMatchObject({ acted: true, wouldRoute: { kind: "escalation", deskId: "desk-it" } });
  });

  it("opens the generic menu when the desk is `none` or under its threshold", async () => {
    registerRuntimeHost({ preflightRoutingEnabled: () => true });
    decisionModel.resolved = answeringModel({ wantsHuman: 0.97, desk: ["none", 0.9], language: ["en", 0.99] });
    const none = await run({ message: "I need a human", flows: routingFlows, desks });
    expect(none.result.parts).toEqual([{ type: "help_desk", action: "suggest_help_desk", label: "Contact support" }]);

    decisionModel.resolved = answeringModel({ wantsHuman: 0.97, desk: ["desk-billing", 0.6], language: ["en", 0.99] });
    const unsure = await run({ message: "talk to a person about my invoice", flows: routingFlows, desks });
    expect(unsure.result.parts).toEqual([{ type: "help_desk", action: "suggest_help_desk", label: "Contact support" }]);
    expect(unsure.result.preflight?.wouldRoute).toEqual({ kind: "escalation", deskId: null });
  });

  it("is today's turn, event for event, below the wants_human threshold", async () => {
    const off = await run({ message: "how do I reset my password", flows: routingFlows, desks });

    registerRuntimeHost({ preflightRoutingEnabled: () => true });
    decisionModel.resolved = answeringModel({ wantsHuman: 0.6, desk: ["desk-it", 0.95], flow: ["flow-password", 0.5] });
    const on = await run({ message: "how do I reset my password", flows: routingFlows, desks });

    expect(on.events).toEqual(off.events);
    expect(on.result.flowName).not.toBe("Escalation");
  });

  it("leaves the existing recommendation path alone under an uncalibrated backend", async () => {
    const off = await run({ message: "I need a human", flows: routingFlows, desks });

    registerRuntimeHost({ preflightRoutingEnabled: () => true });
    decisionModel.resolved = { ...answeringModel({ wantsHuman: 0.99, desk: ["desk-it", 0.99], calibrated: false }), backend: "adapter" };
    const on = await run({ message: "I need a human", flows: routingFlows, desks });

    expect(on.events).toEqual(off.events);
    expect(on.result.preflight?.wouldRoute).toEqual({ kind: "fallback", reason: "uncalibrated" });
  });
});
