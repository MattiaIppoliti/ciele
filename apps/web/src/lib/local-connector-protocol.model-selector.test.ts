import { describe, expect, it } from "vitest";
import { parseLocalModelSelector } from "./local-connector-protocol";

/**
 * The model-selector grammar has a single owner (arch candidate #4, PRD #280):
 * `parseLocalModelSelector` in local-connector-protocol.ts. local-model-options
 * consumes it instead of re-declaring the regex.
 */
describe("parseLocalModelSelector", () => {
  it("parses a well-formed local selector into provider + modelId", () => {
    expect(parseLocalModelSelector("local:openai:gpt-5")).toEqual({
      provider: "openai",
      modelId: "gpt-5",
    });
    expect(parseLocalModelSelector("local:anthropic:claude-opus-4.8")).toEqual({
      provider: "anthropic",
      modelId: "claude-opus-4.8",
    });
  });

  it("rejects non-local, malformed, or non-string selectors", () => {
    for (const bad of [
      "automatic",
      "local:google:gemini", // unsupported provider
      "local:openai:", // empty modelId
      "local:openai", // missing modelId segment
      "openai:gpt-5", // missing local: prefix
      "local:openai:BadCaps", // uppercase not allowed by the grammar
      "",
      undefined,
      null,
      42,
    ]) {
      expect(parseLocalModelSelector(bad)).toBeNull();
    }
  });
});
