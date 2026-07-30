import { describe, expect, it } from "vitest";
import {
  DEFAULT_DWELL_SECONDS,
  actionAllowedForTrigger,
  flowDwellSeconds,
  isProactiveTrigger,
  matchFlow,
  needsVisitorDeliveryHistory,
  notificationDelivery,
  notificationDeliveryRule,
  proactiveDwellSeconds,
  proactiveFlowCandidates,
  proactiveTriggers,
} from "./engine";
import type { Flow } from "./types";

/**
 * The deterministic keyword router (ADR-0003): the offline/no-model
 * classifier fallback. Tested through its public interface — matchFlow picks
 * the Flow; rendering the matched Flow's actions is the LLM runtime's job.
 */

let nextId = 0;

function makeFlow(overrides: Partial<Flow> = {}): Flow {
  nextId += 1;
  return {
    id: `flow-${nextId}`,
    assistantId: "assistant-1",
    name: `Flow ${nextId}`,
    description: "",
    builtIn: false,
    enabled: true,
    position: nextId,
    trigger: "message",
    triggerSettings: {},
    conditionLogic: "any",
    conditions: [],
    actions: ["custom_message"],
    actionSettings: {},
    customMessage: "",
    isDefault: false,
    ...overrides,
  };
}

describe("matchFlow", () => {
  it("routes a built-in trigger phrase to its flow", () => {
    const human = makeFlow({ name: "Human help needed" });
    const defaultFlow = makeFlow({ name: "Default behavior", isDefault: true });
    expect(matchFlow("I want to talk to a human please", [human, defaultFlow])).toBe(
      human
    );
  });

  describe("Basic Interaction is NOT this router's job (#566)", () => {
    // Courtesy routing belongs to `basicInteractionFlow`, consulted above the
    // chat-model branch so both engines share one decision. This router keeps no
    // courtesy vocabulary of its own — a second, additive copy mis-fired.
    const basic = () =>
      makeFlow({
        name: "Basic Interaction",
        builtIn: true,
        position: -1,
        actions: ["basic_reply"],
      });

    it.each([
      // The regression the duplicate copy caused: keyword scoring is additive, so
      // two courtesy words anywhere cleared the threshold and a real question was
      // answered as a greeting.
      "ciao grazie dove trovo il programma",
      "hello thanks where is the exam room",
      "ciao, quando è la scadenza?",
      "hi, what are the opening hours",
    ])("never steals a question containing courtesy words (%s)", (message) => {
      const flow = basic();
      const defaultFlow = makeFlow({ name: "Default behavior", isDefault: true });
      expect(matchFlow(message, [flow, defaultFlow])).toBe(defaultFlow);
    });

    it("does not keyword-boost the flow for a bare greeting either", () => {
      const flow = basic();
      const defaultFlow = makeFlow({ name: "Default behavior", isDefault: true });
      expect(matchFlow("ciao", [flow, defaultFlow])).toBe(defaultFlow);
    });
  });

  it("falls back to the default flow when nothing clears the threshold", () => {
    const niche = makeFlow({ name: "Library opening hours" });
    const defaultFlow = makeFlow({ name: "Default behavior", isDefault: true });
    expect(matchFlow("completely unrelated gibberish", [niche, defaultFlow])).toBe(
      defaultFlow
    );
  });

  it("ignores disabled flows even on a perfect match", () => {
    const human = makeFlow({ name: "Human help needed", enabled: false });
    const defaultFlow = makeFlow({ name: "Default behavior", isDefault: true });
    expect(matchFlow("talk to a human", [human, defaultFlow])).toBe(defaultFlow);
  });

  it("never routes a user message to a non-message-triggered flow", () => {
    const onLoad = makeFlow({ name: "Human help needed", trigger: "page_load" });
    const defaultFlow = makeFlow({ name: "Default behavior", isDefault: true });
    expect(matchFlow("talk to a human", [onLoad, defaultFlow])).toBe(defaultFlow);
  });

  it("boosts a flow whose condition example matches the message verbatim", () => {
    const refund = makeFlow({
      name: "Refunds",
      conditions: [
        {
          id: "c1",
          kind: "conversation_context",
          description: "user asks for money back",
          examples: [
            { message: "give me my money back", note: "", shouldTrigger: true },
          ],
        },
      ],
    });
    const defaultFlow = makeFlow({ name: "Default behavior", isDefault: true });
    expect(
      matchFlow("please give me my money back now", [refund, defaultFlow])
    ).toBe(refund);
  });

  it("rejects a flow when a negative condition example matches", () => {
    const wellbeing = makeFlow({
      name: "Wellbeing support",
      conditions: [
        {
          id: "c1",
          kind: "conversation_context",
          description: "student asks for support",
          examples: [
            { message: "technical support", note: "IT request", shouldTrigger: false },
          ],
        },
      ],
    });
    const defaultFlow = makeFlow({ name: "Default behavior", isDefault: true });

    expect(matchFlow("I need technical support", [wellbeing, defaultFlow])).toBe(
      defaultFlow
    );
  });

  it("requires every condition to match when condition logic is all", () => {
    const gated = makeFlow({
      name: "Enrollment support",
      conditionLogic: "all",
      conditions: [
        { id: "c1", kind: "conversation_context", description: "enrollment", examples: [] },
        { id: "c2", kind: "conversation_context", description: "urgent", examples: [] },
      ],
    });
    const defaultFlow = makeFlow({ name: "Default behavior", isDefault: true });

    expect(matchFlow("enrollment question", [gated, defaultFlow])).toBe(defaultFlow);
    expect(matchFlow("urgent enrollment question", [gated, defaultFlow])).toBe(gated);
  });

  it("requires at least one condition to match when condition logic is any", () => {
    const gated = makeFlow({
      name: "Refund request",
      conditionLogic: "any",
      conditions: [
        { id: "c1", kind: "conversation_context", description: "urgent", examples: [] },
      ],
    });
    const defaultFlow = makeFlow({ name: "Default behavior", isDefault: true });

    expect(matchFlow("refund request", [gated, defaultFlow])).toBe(defaultFlow);
  });

  it("allows one matching condition to satisfy any logic when another is negative", () => {
    const gated = makeFlow({
      name: "Student support",
      conditionLogic: "any",
      conditions: [
        {
          id: "c1",
          kind: "conversation_context",
          description: "technical issue",
          examples: [
            { message: "technical support", note: "not wellbeing", shouldTrigger: false },
          ],
        },
        {
          id: "c2",
          kind: "conversation_context",
          description: "urgent wellbeing",
          examples: [],
        },
      ],
    });
    const defaultFlow = makeFlow({ name: "Default behavior", isDefault: true });

    expect(
      matchFlow("urgent wellbeing and technical support", [gated, defaultFlow])
    ).toBe(gated);
  });

  it("uses position as the tie-breaker when several flows match", () => {
    const higherPriority = makeFlow({
      id: "higher",
      name: "Assistant help first",
      description: "overlapping request",
      position: 0,
    });
    const lowerPriority = makeFlow({
      id: "lower",
      name: "Assistant help second",
      description: "overlapping request",
      position: 1,
    });
    const defaultFlow = makeFlow({ name: "Default behavior", isDefault: true });

    expect(
      matchFlow("I need assistant help", [lowerPriority, defaultFlow, higherPriority])
    ).toBe(higherPriority);
  });

  it("does not keyword-score an objective condition's pattern", () => {
    // "courses" appears only inside the URL pattern. If objective conditions
    // were tokenized like semantic ones, this would match on the word alone.
    const gated = makeFlow({
      name: "Section flow",
      conditions: [
        { id: "c1", kind: "url", operator: "regex", value: ".*/courses/.*" },
      ],
    });
    const defaultFlow = makeFlow({ name: "Default behavior", isDefault: true });

    expect(
      matchFlow("tell me about courses", [gated, defaultFlow], {
        url: "https://site.com/courses/psychology",
      })
    ).toBe(defaultFlow);
  });

  it("drops a flow whose URL condition fails, and keeps it when it passes", () => {
    const gated = makeFlow({
      name: "Human help needed",
      conditions: [
        { id: "c1", kind: "url", operator: "contains", value: "/courses" },
      ],
    });
    const defaultFlow = makeFlow({ name: "Default behavior", isDefault: true });

    expect(
      matchFlow("talk to a human", [gated, defaultFlow], {
        url: "https://site.com/admissions",
      })
    ).toBe(defaultFlow);
    expect(
      matchFlow("talk to a human", [gated, defaultFlow], {
        url: "https://site.com/courses",
      })
    ).toBe(gated);
  });

  it("drops a flow outside its scheduled window", () => {
    const gated = makeFlow({
      name: "Human help needed",
      conditions: [
        {
          id: "c1",
          kind: "schedule",
          startAt: "2026-08-01T09:00",
          endAt: "2026-08-01T18:00",
          timezone: "Europe/Rome",
        },
      ],
    });
    const defaultFlow = makeFlow({ name: "Default behavior", isDefault: true });

    expect(
      matchFlow("talk to a human", [gated, defaultFlow], {
        now: new Date("2026-08-01T20:00:00Z"),
      })
    ).toBe(defaultFlow);
    expect(
      matchFlow("talk to a human", [gated, defaultFlow], {
        now: new Date("2026-08-01T07:30:00Z"),
      })
    ).toBe(gated);
  });

  it("keeps an objectively-gated flow when no routing context is passed", () => {
    const gated = makeFlow({
      name: "Human help needed",
      conditions: [
        { id: "c1", kind: "url", operator: "contains", value: "/courses" },
      ],
    });
    const defaultFlow = makeFlow({ name: "Default behavior", isDefault: true });

    expect(matchFlow("talk to a human", [gated, defaultFlow])).toBe(gated);
  });

  it("returns null when no flow is enabled at all", () => {
    const defaultFlow = makeFlow({
      name: "Default behavior",
      isDefault: true,
      enabled: false,
    });
    expect(matchFlow("hello", [defaultFlow])).toBeNull();
  });
});

/**
 * Proactive triggers (#541): the mirror of matchFlow. A fired client event picks
 * its flows by trigger — no classification, no first-match-wins, because these
 * are announcements rather than answers.
 */
describe("proactiveFlowCandidates", () => {
  const notify = (overrides: Partial<Flow> = {}): Flow =>
    makeFlow({
      trigger: "chat_open",
      actions: ["notification"],
      actionSettings: { notification: { content: "Hi" } },
      ...overrides,
    });

  it("selects every enabled flow on the fired trigger", () => {
    const a = notify({ position: 0 });
    const b = notify({ position: 1 });
    expect(proactiveFlowCandidates([a, b], "chat_open")).toEqual([a, b]);
  });

  it("ignores flows on a different trigger", () => {
    const onOpen = notify();
    const onLoad = notify({ trigger: "page_load" });
    expect(proactiveFlowCandidates([onOpen, onLoad], "chat_open")).toEqual([onOpen]);
  });

  it("never selects a message-triggered flow", () => {
    const message = makeFlow({ trigger: "message" });
    expect(proactiveFlowCandidates([message], "chat_open")).toEqual([]);
  });

  it("treats a legacy flow with no stored trigger as message-triggered", () => {
    const legacy = notify({ trigger: undefined as unknown as Flow["trigger"] });
    expect(proactiveFlowCandidates([legacy], "chat_open")).toEqual([]);
  });

  it("ignores disabled flows", () => {
    expect(proactiveFlowCandidates([notify({ enabled: false })], "chat_open")).toEqual(
      []
    );
  });

  it("ignores the default behavior flow, which has no trigger of its own", () => {
    expect(proactiveFlowCandidates([notify({ isDefault: true })], "chat_open")).toEqual(
      []
    );
  });

  it("returns candidates in configured position order", () => {
    const second = notify({ id: "second", position: 5 });
    const first = notify({ id: "first", position: 1 });
    expect(
      proactiveFlowCandidates([second, first], "chat_open").map((f) => f.id)
    ).toEqual(["first", "second"]);
  });

  it("refuses to select a proactive flow whose actions are not proactive", () => {
    const generative = notify({ actions: ["search_knowledge"] });
    expect(proactiveFlowCandidates([generative], "chat_open")).toEqual([]);
  });

  it("returns nothing for the message trigger — that is matchFlow's job", () => {
    expect(proactiveFlowCandidates([notify()], "message")).toEqual([]);
  });
});

describe("time-on-page dwell", () => {
  const dwellFlow = (
    timeOnPage?: { minutes?: number; seconds?: number },
    overrides: Partial<Flow> = {}
  ): Flow =>
    makeFlow({
      trigger: "time_on_page",
      actions: ["notification"],
      actionSettings: { notification: { content: "Still here?" } },
      ...(timeOnPage ? { triggerSettings: { timeOnPage } } : {}),
      ...overrides,
    });

  it("adds minutes and seconds", () => {
    expect(flowDwellSeconds(dwellFlow({ minutes: 1, seconds: 30 }))).toBe(90);
    expect(flowDwellSeconds(dwellFlow({ seconds: 45 }))).toBe(45);
  });

  it("falls back to the shipped default rather than firing instantly", () => {
    // A zero dwell would make "Time on page" indistinguishable from "On page load".
    expect(flowDwellSeconds(dwellFlow())).toBe(DEFAULT_DWELL_SECONDS);
    expect(flowDwellSeconds(dwellFlow({ minutes: 0, seconds: 0 }))).toBe(
      DEFAULT_DWELL_SECONDS
    );
  });

  it("ignores a nonsensical stored dwell", () => {
    expect(
      flowDwellSeconds(
        dwellFlow({ minutes: Number.NaN, seconds: -10 } as unknown as {
          minutes: number;
        })
      )
    ).toBe(DEFAULT_DWELL_SECONDS);
  });

  it("fires only once the reported dwell has been reached", () => {
    const flow = dwellFlow({ seconds: 45 });
    expect(proactiveFlowCandidates([flow], "time_on_page", { elapsedSeconds: 44 })).toEqual(
      []
    );
    expect(
      proactiveFlowCandidates([flow], "time_on_page", { elapsedSeconds: 45 })
    ).toEqual([flow]);
  });

  it("delivers nothing when the client reports no measure at all", () => {
    // Fails closed: an unmeasured dwell is not a reached dwell.
    expect(proactiveFlowCandidates([dwellFlow({ seconds: 5 })], "time_on_page")).toEqual(
      []
    );
  });

  it("delivers nothing for a garbled elapsed time", () => {
    expect(
      proactiveFlowCandidates([dwellFlow({ seconds: 5 })], "time_on_page", {
        elapsedSeconds: Number.NaN,
      })
    ).toEqual([]);
  });

  it("delivers only the flows whose own dwell has elapsed", () => {
    const early = dwellFlow({ seconds: 10 }, { id: "early", position: 0 });
    const late = dwellFlow({ minutes: 2 }, { id: "late", position: 1 });
    expect(
      proactiveFlowCandidates([early, late], "time_on_page", {
        elapsedSeconds: 30,
      }).map((f) => f.id)
    ).toEqual(["early"]);
  });

  it("enumerates the distinct thresholds the embed must arm", () => {
    const flows = [
      dwellFlow({ seconds: 10 }),
      dwellFlow({ minutes: 2 }),
      dwellFlow({ seconds: 10 }),
      dwellFlow(undefined, { trigger: "chat_open" }),
    ];
    expect(proactiveDwellSeconds(flows)).toEqual([10, 120]);
  });
});

describe("proactiveTriggers", () => {
  const notify = (overrides: Partial<Flow> = {}): Flow =>
    makeFlow({
      trigger: "chat_open",
      actions: ["notification"],
      actionSettings: { notification: { content: "Hi" } },
      ...overrides,
    });

  it("lists only the triggers that have a flow to run", () => {
    expect(proactiveTriggers([notify(), notify({ trigger: "page_load" })])).toEqual([
      "page_load",
      "chat_open",
    ]);
  });

  it("is empty for an assistant with only message flows", () => {
    expect(proactiveTriggers([makeFlow(), makeFlow({ isDefault: true })])).toEqual([]);
  });

  it("does not advertise a trigger whose only flow is disabled", () => {
    expect(proactiveTriggers([notify({ enabled: false })])).toEqual([]);
  });
});

describe("notificationDelivery", () => {
  const ruled = (rule?: "session" | "visitor" | "always"): Flow =>
    makeFlow({
      id: "notify-1",
      trigger: "chat_open",
      actions: ["notification"],
      actionSettings: {
        notification: { content: "Hi", ...(rule ? { deliveryRule: rule } : {}) },
      },
    });
  const flow = ruled();

  it("delivers when the conversation has never seen this flow", () => {
    expect(notificationDelivery(flow, { sessionState: {} }).deliver).toBe(true);
  });

  it("records the delivery in the session-state patch it returns", () => {
    const { sessionPatch } = notificationDelivery(flow, { sessionState: {} });
    expect(sessionPatch).toEqual({ proactive: { "notify-1": 1 } });
  });

  it("suppresses a second delivery in the same conversation", () => {
    const first = notificationDelivery(flow, { sessionState: {} });
    const second = notificationDelivery(flow, {
      sessionState: first.sessionPatch ?? {},
    });
    expect(second.deliver).toBe(false);
    expect(second.sessionPatch).toBeUndefined();
  });

  it("keeps other flows' delivery counts when patching", () => {
    const { sessionPatch } = notificationDelivery(flow, {
      sessionState: { proactive: { other: 2 } },
    });
    expect(sessionPatch).toEqual({ proactive: { other: 2, "notify-1": 1 } });
  });

  it("tolerates a session state whose proactive entry is not an object", () => {
    expect(
      notificationDelivery(flow, { sessionState: { proactive: "nonsense" } })
        .deliver
    ).toBe(true);
  });

  it("treats an unset rule as once per session", () => {
    expect(notificationDeliveryRule(flow)).toBe("session");
    expect(notificationDeliveryRule(ruled("visitor"))).toBe("visitor");
  });

  it("ignores another conversation's delivery under the session rule", () => {
    expect(
      notificationDelivery(flow, {
        sessionState: {},
        visitorStates: [{ proactive: { "notify-1": 1 } }],
      }).deliver
    ).toBe(true);
  });

  it("suppresses a delivery the same visitor already had elsewhere under the visitor rule", () => {
    expect(
      notificationDelivery(ruled("visitor"), {
        sessionState: {},
        visitorStates: [{ proactive: { "notify-1": 1 } }],
      }).deliver
    ).toBe(false);
  });

  it("delivers under the visitor rule when no prior conversation had it", () => {
    expect(
      notificationDelivery(ruled("visitor"), {
        sessionState: {},
        visitorStates: [{ proactive: { other: 3 } }, {}],
      }).deliver
    ).toBe(true);
  });

  it("degrades the visitor rule to per-session when no history is available", () => {
    // Missing history must narrow delivery, never widen it.
    const decision = notificationDelivery(ruled("visitor"), {
      sessionState: { proactive: { "notify-1": 1 } },
    });
    expect(decision.deliver).toBe(false);
  });

  it("always redelivers under the always rule, and keeps counting", () => {
    const decision = notificationDelivery(ruled("always"), {
      sessionState: { proactive: { "notify-1": 4 } },
      visitorStates: [{ proactive: { "notify-1": 9 } }],
    });
    expect(decision.deliver).toBe(true);
    expect(decision.sessionPatch).toEqual({ proactive: { "notify-1": 5 } });
  });

  it("knows when a visitor-history read is needed at all", () => {
    expect(needsVisitorDeliveryHistory([flow, ruled("always")])).toBe(false);
    expect(needsVisitorDeliveryHistory([flow, ruled("visitor")])).toBe(true);
  });
});

describe("trigger/action pairing", () => {
  it("knows which triggers are proactive", () => {
    expect(isProactiveTrigger("message")).toBe(false);
    expect(isProactiveTrigger("page_load")).toBe(true);
    expect(isProactiveTrigger("time_on_page")).toBe(true);
    expect(isProactiveTrigger("chat_open")).toBe(true);
  });

  it("allows only the notification action on a proactive trigger", () => {
    expect(actionAllowedForTrigger("notification", "chat_open")).toBe(true);
    expect(actionAllowedForTrigger("search_knowledge", "chat_open")).toBe(false);
    expect(actionAllowedForTrigger("custom_message", "chat_open")).toBe(false);
  });

  it("refuses the notification action on a message trigger", () => {
    expect(actionAllowedForTrigger("notification", "message")).toBe(false);
    expect(actionAllowedForTrigger("custom_message", "message")).toBe(true);
  });
});
