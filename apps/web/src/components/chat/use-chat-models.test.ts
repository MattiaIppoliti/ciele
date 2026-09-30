import { describe, expect, it } from "vitest";
import { AUTO_CHAT_MODEL, toPromptModels } from "./use-chat-models";

describe("Assistant Auto model option", () => {
  it("keeps Auto visible when there are no connected alternatives", () => {
    expect(toPromptModels([], true)).toMatchObject([{ value: AUTO_CHAT_MODEL, label: "Auto", description: "Balances speed, effort, and cost.", separatorAfter: false }]);
  });
  it("keeps missing connections disabled alongside Auto", () => {
    const rows = toPromptModels([{
      selector: "google:gemini-3.5-flash",
      provider: "google",
      modelId: "gemini-3.5-flash",
      label: "Gemini 3.5 Flash",
      providerName: "Google",
      unavailable: true,
    }], true);
    expect(rows[0]).toMatchObject({ value: AUTO_CHAT_MODEL, label: "Auto", separatorAfter: true });
    expect(rows[0].icon).toBeDefined();
    expect(rows[1].disabled).toBe(true);
    expect(toPromptModels([])).toEqual([]);
  });
});
