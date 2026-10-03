import { describe, expect, it } from "vitest";
import { chatAllowedModels } from "./ciele-ai";

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
