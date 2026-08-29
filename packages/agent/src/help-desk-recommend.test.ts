import { describe, expect, it } from "vitest";
import { MockLanguageModelV3 } from "ai/test";
import type { Assistant } from "@agent-hub/core";
import { buildHelpDeskRecommender } from "./help-desk-recommend";

/**
 * The desk recommender tested through its closure: what id it resolves for a
 * given toggle/desks/model configuration, the model is mocked, never called
 * for real (prior art: engine.test.ts pickerModel).
 */

const DESKS = [
  { id: "d-it", name: "IT Desk", description: "Wifi, accounts, devices" },
  { id: "d-admissions", name: "Admissions", description: "Applying, enrollment" },
];

function assistant(overrides: Partial<Assistant["helpDeskSettings"]> = {}) {
  return {
    helpDeskSettings: { aiRecommended: true, ...overrides },
  } as Assistant;
}

function deskModel(deskId: string | null) {
  return new MockLanguageModelV3({
    doGenerate: {
      content: [{ type: "text" as const, text: JSON.stringify({ deskId }) }],
      finishReason: { unified: "stop" as const, raw: "stop" },
      usage: {
        inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
        outputTokens: { total: 1, text: 1, reasoning: undefined },
      },
      warnings: [],
    },
  });
}

const TURN = { message: "the wifi keeps dropping", history: [] };

describe("buildHelpDeskRecommender", () => {
  it("recommends the desk the classifier picks", async () => {
    const recommend = buildHelpDeskRecommender({
      assistant: assistant(),
      desks: DESKS,
      model: deskModel("d-it"),
      ...TURN,
    });
    expect(await recommend()).toBe("d-it");
  });

  it("returns null when the toggle is off", async () => {
    const model = deskModel("d-it");
    const recommend = buildHelpDeskRecommender({
      assistant: assistant({ aiRecommended: false }),
      desks: DESKS,
      model,
      ...TURN,
    });
    expect(await recommend()).toBeNull();
    expect(model.doGenerateCalls).toHaveLength(0);
  });

  it("returns the only selected desk without a model call", async () => {
    const model = deskModel("d-admissions");
    const recommend = buildHelpDeskRecommender({
      assistant: assistant(),
      desks: [DESKS[0]],
      model,
      ...TURN,
    });
    expect(await recommend()).toBe("d-it");
    expect(model.doGenerateCalls).toHaveLength(0);
  });

  it("returns null with no model or no desks", async () => {
    expect(
      await buildHelpDeskRecommender({
        assistant: assistant(),
        desks: DESKS,
        model: null,
        ...TURN,
      })()
    ).toBeNull();
    expect(
      await buildHelpDeskRecommender({
        assistant: assistant(),
        desks: [],
        model: deskModel("d-it"),
        ...TURN,
      })()
    ).toBeNull();
  });

  it("rejects hallucinated desk ids and caches the single classification", async () => {
    const model = deskModel("d-made-up");
    const recommend = buildHelpDeskRecommender({
      assistant: assistant(),
      desks: DESKS,
      model,
      ...TURN,
    });
    expect(await recommend()).toBeNull();
    expect(await recommend()).toBeNull();
    expect(model.doGenerateCalls).toHaveLength(1);
  });

  it("degrades to null when the classifier throws", async () => {
    const failing = new MockLanguageModelV3({
      doGenerate: () => {
        throw new Error("provider down");
      },
    });
    const recommend = buildHelpDeskRecommender({
      assistant: assistant(),
      desks: DESKS,
      model: failing,
      ...TURN,
    });
    expect(await recommend()).toBeNull();
  });
});
