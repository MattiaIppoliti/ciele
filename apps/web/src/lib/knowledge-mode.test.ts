import { describe, expect, it } from "vitest";
import { assistantKnowledgeHref, parseKnowledgeMode } from "./knowledge-mode";

describe("parseKnowledgeMode", () => {
  it("reads a known tab and falls back to Websites", () => {
    expect(parseKnowledgeMode("applications")).toBe("applications");
    expect(parseKnowledgeMode("nonsense")).toBe("websites");
    expect(parseKnowledgeMode(undefined)).toBe("websites");
  });
});

describe("assistantKnowledgeHref", () => {
  it("returns an application Source's crumbs to the Applications tab", () => {
    expect(assistantKnowledgeHref("a1", "application")).toBe(
      "/assistants/a1/knowledge?mode=applications"
    );
    // Round trip: the route reads back the tab the crumb names.
    const mode = new URL(assistantKnowledgeHref("a1", "application"), "http://x").searchParams.get(
      "mode"
    );
    expect(parseKnowledgeMode(mode ?? undefined)).toBe("applications");
  });

  it("leaves every other kind on the default tab", () => {
    expect(assistantKnowledgeHref("a1", "website")).toBe("/assistants/a1/knowledge");
    expect(assistantKnowledgeHref("a1", "file")).toBe("/assistants/a1/knowledge");
  });
});
