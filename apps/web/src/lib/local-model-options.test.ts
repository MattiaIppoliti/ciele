import { describe, expect, it } from "vitest";
import {
  buildModelOptionGroups,
  applyLocalPreviewModelPreference,
  resolveLocalPreviewModelPreference,
} from "./local-model-options";

describe("buildModelOptionGroups", () => {
  it("shows only models exposed by connected local subscriptions", () => {
    const groups = buildModelOptionGroups({
      localProviders: [
        {
          provider: "openai",
          label: "ChatGPT Subscription",
          available: true,
          connected: true,
          connecting: false,
          models: [
            {
              id: "gpt-5.6-sol",
              label: "GPT-5.6-Sol",
              inputModalities: ["text", "image"],
            },
          ],
        },
      ],
    });

    expect(groups.map((group) => group.label)).toEqual(["Local subscriptions"]);
    expect(groups.flatMap((group) => group.options.map((option) => option.value)))
      .toEqual(
        expect.arrayContaining([
          "local:openai:gpt-5.6-sol",
        ])
      );
  });
});

describe("resolveLocalPreviewModelPreference", () => {
  it("applies a source-qualified local model only when that subscription is verified", () => {
    expect(
      resolveLocalPreviewModelPreference(
        "local:openai:gpt-5.6-sol",
        ["openai"]
      )
    ).toEqual({ provider: "openai", modelId: "gpt-5.6-sol" });
    expect(
      resolveLocalPreviewModelPreference(
        "local:anthropic:opus",
        ["openai"]
      )
    ).toBeNull();
  });

  it.each([
    "automatic",
    "platform:openai:gpt-5.6-sol",
    "local:google:gemini-3.5-flash",
    "local:openai:../../bin/sh",
  ])("does not treat %s as a local subscription override", (selector) => {
    expect(resolveLocalPreviewModelPreference(selector, ["openai", "anthropic"]))
      .toBeNull();
  });
});

describe("applyLocalPreviewModelPreference", () => {
  const assistant = { modelProvider: "google" as const, modelId: "gemini-default" };

  it("changes the runtime provider and model for a verified local selector", () => {
    expect(
      applyLocalPreviewModelPreference(
        assistant,
        "local:anthropic:opus",
        ["anthropic"]
      )
    ).toEqual({ modelProvider: "anthropic", modelId: "opus" });
  });

  it("keeps the configured assistant for an unverified selector", () => {
    expect(
      applyLocalPreviewModelPreference(
        assistant,
        "local:openai:gpt-5.6-sol",
        ["anthropic"]
      )
    ).toBe(assistant);
  });
});
