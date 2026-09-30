import { describe, expect, it } from "vitest";
import { chatAllowedModels, cieleAiPickerModels } from "./ciele-ai";

describe("the models a chat may be asked on", () => {
  it("offers Ciele AI the whole catalogue until somebody narrows it", () => {
    const all = chatAllowedModels({ allowedModels: [], systemKind: "ciele_ai" });
    expect(all.length).toBeGreaterThan(5);
    const narrowed = [{ provider: "anthropic" as const, modelId: "claude-opus-4-8" }];
    expect(chatAllowedModels({ allowedModels: narrowed, systemKind: "ciele_ai" })).toEqual(narrowed);
  });

  it("keeps a Teammate's own list, empty included", () => {
    expect(chatAllowedModels({ allowedModels: [], systemKind: null })).toEqual([]);
  });
});

describe("Ciele AI's model picker", () => {
  it("is never empty: with no connection every model is listed, and none can be asked", () => {
    const rows = cieleAiPickerModels({ allowedModels: [], systemKind: "ciele_ai" }, []);
    expect(rows.length).toBeGreaterThan(5);
    expect(rows.every((row) => row.unavailable)).toBe(true);
  });

  it("lists what a connection serves first, and never twice", () => {
    const askable = [
      {
        selector: "anthropic:claude-opus-4-8",
        provider: "anthropic" as const,
        modelId: "claude-opus-4-8",
        label: "Claude Opus 4.8",
        providerName: "Anthropic",
      },
    ];
    const rows = cieleAiPickerModels({ allowedModels: [], systemKind: "ciele_ai" }, askable);
    expect(rows[0]).toEqual(askable[0]);
    expect(rows.filter((row) => row.modelId === "claude-opus-4-8")).toHaveLength(1);
    expect(rows.slice(1).every((row) => row.unavailable)).toBe(true);
  });
});
