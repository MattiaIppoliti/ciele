import { describe, expect, it } from "vitest";
import { matchFlow } from "./engine";
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

  it("returns null when no flow is enabled at all", () => {
    const defaultFlow = makeFlow({
      name: "Default behavior",
      isDefault: true,
      enabled: false,
    });
    expect(matchFlow("hello", [defaultFlow])).toBeNull();
  });
});
