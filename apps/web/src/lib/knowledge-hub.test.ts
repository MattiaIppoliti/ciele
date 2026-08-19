import { describe, expect, it } from "vitest";
import {
  KNOWLEDGE_TAB_KINDS,
  assistantScopedKnowledge,
  sharedAssistantNames,
  sourceRemovalChoice,
  directAccessSummary,
  isKnowledgeTabSlug,
  knowledgeTabForKind,
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

describe("knowledgeTabForKind", () => {
  it("routes every kind to the tab that lists it", () => {
    expect(knowledgeTabForKind("website")).toBe("websites");
    expect(knowledgeTabForKind("url")).toBe("websites");
    expect(knowledgeTabForKind("file")).toBe("files");
    expect(knowledgeTabForKind("text")).toBe("files");
    expect(knowledgeTabForKind("faq")).toBe("faqs");
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

describe("assistant-scoped knowledge (the editor's link filter)", () => {
  // The derivation reads two fields, so the fixtures carry exactly those.
  const source = (id: string) => ({ id });
  const concept = (id: string, sourceId: string | null) => ({ id, sourceId });

  it("keeps only what the assistant is linked to", () => {
    const scoped = assistantScopedKnowledge({
      linkedSourceIds: ["s-mine"],
      // Both Sources sit in the same org-owned Collection; only one is linked.
      sources: [source("s-mine"), source("s-sibling")],
      concepts: [concept("c-mine", "s-mine"), concept("c-sibling", "s-sibling")],
    });
    expect(scoped.sources.map((s) => s.id)).toEqual(["s-mine"]);
    expect(scoped.concepts.map((c) => c.id)).toEqual(["c-mine"]);
  });

  it("drops source-less Concepts, which retrieval cannot reach either", () => {
    const scoped = assistantScopedKnowledge({
      linkedSourceIds: ["s-mine"],
      sources: [source("s-mine")],
      concepts: [concept("c-orphan", null)],
    });
    expect(scoped.concepts).toEqual([]);
  });

  it("shows nothing when the assistant is linked to nothing", () => {
    const scoped = assistantScopedKnowledge({
      linkedSourceIds: [],
      sources: [source("s-sibling")],
      concepts: [concept("c-sibling", "s-sibling")],
    });
    expect(scoped).toEqual({ sources: [], concepts: [] });
  });
});

describe("shared-assistant names (the editor's delete blast radius)", () => {
  const link = (assistantId: string, assistantName: string) => ({
    assistantId,
    assistantName,
    directAccess: false,
  });

  it("names the other assistants, sorted, and skips unshared Sources", () => {
    expect(
      sharedAssistantNames("a-1", [
        {
          id: "s-shared",
          linkedAssistants: [
            link("a-1", "Mine"),
            link("a-3", "Zeta desk"),
            link("a-2", "Alpha desk"),
          ],
        },
        { id: "s-mine", linkedAssistants: [link("a-1", "Mine")] },
        { id: "s-orphan", linkedAssistants: [] },
      ])
    ).toEqual({ "s-shared": ["Alpha desk", "Zeta desk"] });
  });

  it("drops a nameless link rather than rendering an empty chip", () => {
    expect(
      sharedAssistantNames("a-1", [
        { id: "s", linkedAssistants: [link("a-1", "Mine"), link("a-2", "")] },
      ])
    ).toEqual({});
  });
});

describe("source removal choice (unlink vs delete)", () => {
  const effect = "The website and every page crawled from it go.";

  it("deletes outright when only this assistant answers from it", () => {
    expect(
      sourceRemovalChoice({
        name: "Docs site",
        sharedWith: [],
        deleteLabel: "Delete website",
        deleteEffect: effect,
      })
    ).toEqual({
      mode: "delete",
      name: "Docs site",
      description:
        "The website and every page crawled from it go. This cannot be undone.",
      confirmLabel: "Delete website",
    });
  });

  it("unlinks by default when shared, naming who keeps it", () => {
    const choice = sourceRemovalChoice({
      name: "Docs site",
      sharedWith: ["Alpha desk", "Support bot", "Zeta"],
      deleteLabel: "Delete website",
      deleteEffect: effect,
    });
    expect(choice.mode).toBe("unlink");
    expect(choice.confirmLabel).toBe("Remove from this assistant");
    expect(choice.secondaryLabel).toBe("Delete for the organization");
    expect(choice.description).toBe(
      "It stays in the Library and keeps answering for Alpha desk, Support bot and Zeta. " +
        "Deleting it for the whole organization instead removes it everywhere: " +
        "the website and every page crawled from it go."
    );
  });

  it("reads naturally with a single other assistant", () => {
    expect(
      sourceRemovalChoice({
        name: "Handbook.pdf",
        sharedWith: ["Support bot"],
        deleteLabel: "Delete document",
        deleteEffect: "The document and everything indexed from it go.",
      }).description
    ).toContain("keeps answering for Support bot.");
  });
});
