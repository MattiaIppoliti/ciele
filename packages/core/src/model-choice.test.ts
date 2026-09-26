import { describe, expect, it } from "vitest";
import {
  modelChoices,
  modelSelector,
  parseModelSelector,
  resolveRequestedModel,
  sameModel,
  type ModelRef,
} from "./model-choice";

const CONFIGURED: ModelRef = { provider: "google", modelId: "gemini-3.5-flash" };
const SONNET: ModelRef = { provider: "anthropic", modelId: "claude-sonnet-5" };
const GPT: ModelRef = { provider: "openai", modelId: "gpt-5.1" };

describe("sameModel", () => {
  it("compares both halves", () => {
    expect(sameModel(SONNET, { ...SONNET })).toBe(true);
    expect(sameModel(SONNET, { ...SONNET, modelId: "claude-opus-4-8" })).toBe(
      false
    );
    expect(sameModel(SONNET, { ...SONNET, provider: "openai" })).toBe(false);
  });
});

describe("modelChoices", () => {
  it("offers only the configured model when the allow-list is empty", () => {
    expect(modelChoices(CONFIGURED, [])).toEqual([CONFIGURED]);
  });

  it("puts the configured model first even when the list omits it", () => {
    expect(modelChoices(CONFIGURED, [GPT, SONNET])).toEqual([
      CONFIGURED,
      GPT,
      SONNET,
    ]);
  });

  it("never lists the configured model twice", () => {
    expect(modelChoices(CONFIGURED, [SONNET, CONFIGURED])).toEqual([
      CONFIGURED,
      SONNET,
    ]);
  });

  it("keeps the admin's ordering when the list repeats itself", () => {
    expect(modelChoices(CONFIGURED, [GPT, SONNET, GPT])).toEqual([
      CONFIGURED,
      GPT,
      SONNET,
    ]);
  });
});

describe("resolveRequestedModel", () => {
  it("runs the configured model when nothing was requested", () => {
    expect(resolveRequestedModel(null, CONFIGURED, [SONNET])).toEqual(
      CONFIGURED
    );
    expect(resolveRequestedModel(undefined, CONFIGURED, [SONNET])).toEqual(
      CONFIGURED
    );
  });

  it("honours a request that is on the list", () => {
    expect(resolveRequestedModel(SONNET, CONFIGURED, [SONNET, GPT])).toEqual(
      SONNET
    );
  });

  it("honours a request naming the configured model itself", () => {
    expect(resolveRequestedModel(CONFIGURED, CONFIGURED, [])).toEqual(
      CONFIGURED
    );
  });

  // The stale-Publication case: a widget cached on a customer's page offers a
  // model the org has since removed. The turn must still answer.
  it("falls back rather than refusing when the request is off the list", () => {
    expect(resolveRequestedModel(GPT, CONFIGURED, [SONNET])).toEqual(CONFIGURED);
  });

  it("cannot introduce a model the allow-list never named", () => {
    const smuggled: ModelRef = { provider: "openai", modelId: "gpt-9-secret" };
    expect(resolveRequestedModel(smuggled, CONFIGURED, [SONNET])).toEqual(
      CONFIGURED
    );
  });

  it("refuses a request when the allow-list is empty, choice being off", () => {
    expect(resolveRequestedModel(SONNET, CONFIGURED, [])).toEqual(CONFIGURED);
  });
});

describe("parseModelSelector", () => {
  it("round-trips a ref", () => {
    expect(parseModelSelector(modelSelector(SONNET))).toEqual(SONNET);
  });

  it("splits at the first colon, so a model id may carry one", () => {
    expect(parseModelSelector("openai_compatible:org/model:v2")).toEqual({
      provider: "openai_compatible",
      modelId: "org/model:v2",
    });
  });

  it("rejects what is not a selector", () => {
    for (const input of [null, undefined, "", "anthropic", ":model", 42]) {
      expect(parseModelSelector(input as string)).toBeNull();
    }
  });

  it("rejects a selector with no model id", () => {
    expect(parseModelSelector("anthropic:")).toBeNull();
    expect(parseModelSelector("anthropic:   ")).toBeNull();
  });
});
