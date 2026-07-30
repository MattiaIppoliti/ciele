import { describe, expect, it } from "vitest";
import { getMockDb, DEMO_ORG } from "@agent-hub/db";
import type { ChatReplyPart } from "./types";
import {
  computeTier,
  needsWatchEscalation,
  runTrustMaterialization,
  TRUST_WINDOW,
} from "./trust";

describe("computeTier (pure boundaries)", () => {
  it("a new pair lands at watch", () => {
    expect(computeTier(0, 0)).toBe("watch");
  });
  it("under 10 runs is watch regardless of rate", () => {
    expect(computeTier(9, 9)).toBe("watch");
  });
  it("rate boundaries around 90%", () => {
    expect(computeTier(10, 9)).toBe("queue"); // exactly 90%
    expect(computeTier(10, 8)).toBe("watch"); // 80%
  });
  it("auto needs BOTH 20 runs and 95%", () => {
    expect(computeTier(19, 19)).toBe("queue"); // perfect rate, one run short
    expect(computeTier(20, 19)).toBe("auto"); // exactly 95%
    expect(computeTier(20, 18)).toBe("queue"); // 90%
  });
  it("the window bounds runs", () => {
    expect(computeTier(TRUST_WINDOW, 48)).toBe("auto"); // 96%
    expect(computeTier(TRUST_WINDOW, 47)).toBe("queue"); // 94%
  });
});

describe("needsWatchEscalation (runtime behavior rule)", () => {
  const generative: ChatReplyPart = {
    type: "text",
    action: "search_knowledge",
    text: "answer",
  };
  const helpDesk: ChatReplyPart = {
    type: "help_desk",
    action: "suggest_help_desk",
    label: "Contact support",
  };
  const verbatim: ChatReplyPart = {
    type: "text",
    action: "custom_message",
    text: "Exact words.",
  };

  it("appends only for watch-tier generative answers", () => {
    expect(needsWatchEscalation([generative], "watch")).toBe(true);
  });
  it("fail-open: missing tier and queue/auto change nothing", () => {
    expect(needsWatchEscalation([generative], null)).toBe(false);
    expect(needsWatchEscalation([generative], "queue")).toBe(false);
    expect(needsWatchEscalation([generative], "auto")).toBe(false);
  });
  it("deduplicates when an escalation part is already present", () => {
    expect(needsWatchEscalation([generative, helpDesk], "watch")).toBe(false);
  });
  it("non-generative answers are untouched even on watch", () => {
    expect(needsWatchEscalation([verbatim], "watch")).toBe(false);
  });
  it("a courtesy reply never gets the escalation offer stapled to it", () => {
    // Basic Interaction (#565) is generated, but it grounds nothing and answers
    // no question — "Contact support" under "Hello!" reads as a broken assistant.
    const courtesy: ChatReplyPart = {
      type: "text",
      action: "basic_reply",
      text: "Hi! What would you like to know?",
    };
    expect(needsWatchEscalation([courtesy], "watch")).toBe(false);
  });
});

describe("runTrustMaterialization", () => {
  const db = getMockDb();
  const FLOW = "flow-trust-fixture";
  let seq = 0;

  async function seedVerdict(assistantId: string, pass: boolean) {
    seq += 1;
    await db.recordAnswerVerdict({
      messageId: `trust-msg-${assistantId}-${seq}`,
      organizationId: DEMO_ORG.id,
      assistantId,
      flowId: FLOW,
      verdict: pass ? "pass" : "fail",
      reason: pass ? "grounded" : "unsupported claim",
      modelId: "test",
    });
  }

  const activeDemotionAlerts = async () =>
    (await db.listAlerts(DEMO_ORG.id)).filter(
      (a) => a.sourceKey === `flow-trust:${FLOW}` && a.status === "active"
    );

  it("earns auto, demotes to watch with one Alert, and recovers", async () => {
    const assistant = await db.createAssistant(DEMO_ORG.id, {
      title: "Trust Fixture",
    });

    // 20 clean runs → auto.
    for (let i = 0; i < 20; i++) await seedVerdict(assistant.id, true);
    await runTrustMaterialization({ db });
    let trust = await db.getFlowTrust(assistant.id, FLOW);
    expect(trust).toMatchObject({ runs: 20, passes: 20, tier: "auto" });
    expect(await activeDemotionAlerts()).toHaveLength(0);

    // A burst of failures drags the rolling rate under 90% → watch + Alert.
    for (let i = 0; i < 5; i++) await seedVerdict(assistant.id, false);
    await runTrustMaterialization({ db });
    trust = await db.getFlowTrust(assistant.id, FLOW);
    expect(trust?.tier).toBe("watch");
    expect(trust?.previousTier).toBe("auto");
    const alerts = await activeDemotionAlerts();
    expect(alerts).toHaveLength(1);
    expect(alerts[0].detail).toContain("unsupported claim");

    // Idempotence: same signals, same tier, still exactly one active Alert.
    await runTrustMaterialization({ db });
    expect(await activeDemotionAlerts()).toHaveLength(1);

    // Recovery: enough fresh passes push the rate back over 90% → the Alert
    // auto-resolves on the watch → queue/auto transition.
    for (let i = 0; i < 30; i++) await seedVerdict(assistant.id, true);
    await runTrustMaterialization({ db });
    trust = await db.getFlowTrust(assistant.id, FLOW);
    expect(trust?.tier).not.toBe("watch");
    expect(await activeDemotionAlerts()).toHaveLength(0);
  });

  it("caps each pair at the rolling window", async () => {
    const assistant = await db.createAssistant(DEMO_ORG.id, {
      title: "Trust Window Fixture",
    });
    for (let i = 0; i < TRUST_WINDOW + 15; i++) {
      await seedVerdict(assistant.id, true);
    }
    await runTrustMaterialization({ db });
    const trust = await db.getFlowTrust(assistant.id, FLOW);
    expect(trust?.runs).toBe(TRUST_WINDOW);
  });
});

describe("demotion history events", () => {
  const db = getMockDb();
  const FLOW = "demotion-history-flow";
  let seq = 0;

  async function seedVerdict(assistantId: string, pass: boolean) {
    seq += 1;
    await db.recordAnswerVerdict({
      messageId: `demote-msg-${assistantId}-${seq}`,
      organizationId: DEMO_ORG.id,
      assistantId,
      flowId: FLOW,
      verdict: pass ? "pass" : "fail",
      reason: pass ? "grounded" : "unsupported claim",
      modelId: "test",
    });
  }

  it("writes exactly one event per tier transition and none for non-transitions", async () => {
    const assistant = await db.createAssistant(DEMO_ORG.id, {
      title: "Demotion History Fixture",
    });

    // First materialization: 20 clean runs → auto. One event (null → auto).
    for (let i = 0; i < 20; i++) await seedVerdict(assistant.id, true);
    await runTrustMaterialization({ db });
    let events = await db.listFlowTrustEvents(assistant.id, FLOW);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ fromTier: null, toTier: "auto" });

    // Re-materialize with the same signals: no transition, no new event.
    await runTrustMaterialization({ db });
    expect(await db.listFlowTrustEvents(assistant.id, FLOW)).toHaveLength(1);

    // Failures drag the rate under 90% → watch. A second event (auto → watch).
    for (let i = 0; i < 5; i++) await seedVerdict(assistant.id, false);
    await runTrustMaterialization({ db });
    events = await db.listFlowTrustEvents(assistant.id, FLOW);
    expect(events).toHaveLength(2);
    // Newest first: the demotion, carrying the runs/passes at the transition.
    expect(events[0]).toMatchObject({
      fromTier: "auto",
      toTier: "watch",
      runs: 25,
      passes: 20,
    });
  });
});
