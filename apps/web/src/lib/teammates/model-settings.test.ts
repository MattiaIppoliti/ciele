import { describe, expect, it } from "vitest";
import { teammateModelPatch } from "./model-settings";

describe("Teammate default model settings", () => {
  const before = { modelProvider: "google" as const, modelId: "gemini-3.5-flash" };
  it("leaves an untouched default out of unrelated saves", () => {
    expect(teammateModelPatch(before, before)).toEqual({});
  });
  it("changes a model without changing the provider", () => {
    expect(teammateModelPatch(before, { ...before, modelId: "gemini-3.5-flash-lite" })).toEqual({ modelId: "gemini-3.5-flash-lite" });
  });
  it("writes a selected provider and model together", () => {
    expect(teammateModelPatch(before, { modelProvider: "anthropic", modelId: "claude-sonnet-5" })).toEqual({ modelProvider: "anthropic", modelId: "claude-sonnet-5" });
  });
});
