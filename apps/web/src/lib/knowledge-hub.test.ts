import { describe, expect, it } from "vitest";
import {
  KNOWLEDGE_TAB_KINDS,
  directAccessSummary,
  isKnowledgeTabSlug,
  parseHubSearchParams,
  sourceTypeLabel,
  tabHealth,
} from "./knowledge-hub";

describe("tab kind buckets", () => {
  it("covers every Source kind exactly once across the three tabs", () => {
    const all = Object.values(KNOWLEDGE_TAB_KINDS).flat().sort();
    expect(all).toEqual(["faq", "file", "text", "url", "website"]);
  });

  it("recognizes only the three slugs", () => {
    expect(isKnowledgeTabSlug("websites")).toBe(true);
    expect(isKnowledgeTabSlug("files")).toBe(true);
    expect(isKnowledgeTabSlug("faqs")).toBe(true);
    expect(isKnowledgeTabSlug("courses")).toBe(false);
    expect(isKnowledgeTabSlug("")).toBe(false);
  });
});

describe("tabHealth", () => {
  it("rolls up error > processing > ready, and no dot when empty", () => {
    expect(tabHealth({ processing: 2, ready: 5, error: 1 })).toBe("error");
    expect(tabHealth({ processing: 2, ready: 5, error: 0 })).toBe("processing");
    expect(tabHealth({ processing: 0, ready: 5, error: 0 })).toBe("ready");
    expect(tabHealth({ processing: 0, ready: 0, error: 0 })).toBeNull();
  });
});

describe("directAccessSummary", () => {
  const link = (directAccess: boolean) => ({
    assistantId: "a",
    assistantName: "A",
    directAccess,
  });

  it("summarizes by how many links have the flag on", () => {
    expect(directAccessSummary([])).toBe("No direct access");
    expect(directAccessSummary([link(false), link(false)])).toBe(
      "No direct access"
    );
    expect(directAccessSummary([link(true), link(false)])).toBe("1 assistant");
    expect(directAccessSummary([link(true), link(true)])).toBe("2 assistants");
  });
});

describe("sourceTypeLabel", () => {
  it("labels every kind", () => {
    expect(sourceTypeLabel("website")).toBe("Entire website");
    expect(sourceTypeLabel("url")).toBe("Page");
    expect(sourceTypeLabel("file")).toBe("File");
    expect(sourceTypeLabel("text")).toBe("Text");
    expect(sourceTypeLabel("faq")).toBe("FAQ");
  });
});

describe("parseHubSearchParams", () => {
  it("parses valid params and takes the first of repeated ones", () => {
    expect(
      parseHubSearchParams({
        q: "guide",
        status: "error",
        assistant: ["as-1", "as-2"],
        page: "3",
      })
    ).toEqual({ q: "guide", status: "error", assistant: "as-1", page: 3 });
  });

  it("falls back to defaults on garbage", () => {
    expect(
      parseHubSearchParams({ status: "bogus", page: "-2" })
    ).toEqual({ q: "", status: "", assistant: "", page: 1 });
    expect(parseHubSearchParams({ page: "NaN" }).page).toBe(1);
  });

  it("caps the free-text query length", () => {
    expect(parseHubSearchParams({ q: "x".repeat(500) }).q).toHaveLength(200);
  });
});
