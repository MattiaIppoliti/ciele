import { describe, expect, it } from "vitest";
import {
  KNOWLEDGE_TAB_KINDS,
  assistantScopedKnowledge,
  sharedAssistantNames,
  bulkRemovalChoice,
  sourceRemovalChoice,
  directAccessSummary,
  isKnowledgeTabSlug,
  knowledgeTabForKind,
  parseHubSearchParams,
  sourceTypeLabel,
  tabHealth,
} from "./knowledge-hub";

describe("tab kind buckets", () => {
  it("covers every Source kind exactly once across the four tabs", () => {
    const all = Object.values(KNOWLEDGE_TAB_KINDS).flat().sort();
    expect(all).toEqual([
      "application",
      "faq",
      "file",
      "text",
      "url",
      "website",
    ]);
  });

  it("recognizes only the three slugs", () => {
    expect(isKnowledgeTabSlug("websites")).toBe(true);
    expect(isKnowledgeTabSlug("files")).toBe(true);
    expect(isKnowledgeTabSlug("applications")).toBe(true);
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
    ).toEqual({
      q: "guide",
      status: "error",
      assistant: "as-1",
      page: 3,
      size: 25,
      sort: "",
      ascending: false,
    });
  });

  it("falls back to defaults on garbage", () => {
    expect(parseHubSearchParams({ status: "bogus", page: "-2" })).toEqual({
      q: "",
      status: "",
      assistant: "",
      page: 1,
      size: 25,
      sort: "",
      ascending: false,
    });
    expect(parseHubSearchParams({ page: "NaN" }).page).toBe(1);
  });

  it("reads the clicked column and its direction", () => {
    expect(parseHubSearchParams({ sort: "name", dir: "asc" })).toMatchObject({
      sort: "name",
      ascending: true,
    });
    // A column the table cannot sort on reads as no sort, which is the
    // default order, rather than as an error page.
    expect(parseHubSearchParams({ sort: "conceptCount" }).sort).toBe("");
    expect(parseHubSearchParams({ sort: "name" }).ascending).toBe(false);
  });

  it("narrows the page size to one the footer offers", () => {
    expect(parseHubSearchParams({ size: "10" }).size).toBe(10);
    // A LIMIT reads this number, so anything else falls back to the default.
    expect(parseHubSearchParams({ size: "100000" }).size).toBe(25);
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

describe("bulkRemovalChoice", () => {
  const faq = {
    noun: "FAQ",
    pluralNoun: "FAQs",
    deleteLabel: "Delete FAQs",
    deleteEffect: "The questions and their answers go.",
  };

  it("is a plain delete when nothing ticked is shared", () => {
    const choice = bulkRemovalChoice({ ...faq, count: 12, sharedCount: 0 });
    expect(choice.mode).toBe("delete");
    expect(choice.title).toBe("Delete 12 FAQs?");
    expect(choice.confirmLabel).toBe("Delete FAQs");
    expect(choice.secondaryLabel).toBeUndefined();
  });

  it("offers the pair as soon as one ticked row is shared", () => {
    // The whole point: a FAQ owns its Source, so a bulk delete that did not
    // ask would take that row out of every other assistant answering from it.
    const choice = bulkRemovalChoice({ ...faq, count: 12, sharedCount: 1 });
    expect(choice.mode).toBe("unlink");
    expect(choice.title).toBe("Remove 12 FAQs from this assistant?");
    expect(choice.confirmLabel).toBe("Remove from this assistant");
    expect(choice.secondaryLabel).toBe("Delete for the organization");
    // Remove unlinks the whole selection, so the sentence says all twelve
    // stay in the Library and only the shared one keeps answering; claiming
    // the other eleven still answer somewhere would be the same
    // over-promise the plain Delete made about the shared one.
    expect(choice.description).toBe(
      "They stay in the Library, and the 1 shared with other assistants keep " +
        "answering there. Deleting them for the whole organization instead " +
        "removes them everywhere: the questions and their answers go."
    );
  });

  it("drops the count when every ticked row is shared", () => {
    expect(
      bulkRemovalChoice({ ...faq, count: 4, sharedCount: 4 }).description
    ).toContain(
      "They stay in the Library and keep answering for the other assistants linked to them."
    );
    expect(
      bulkRemovalChoice({ ...faq, count: 1, sharedCount: 1 }).description
    ).toContain(
      "It stays in the Library and keeps answering for the other assistants linked to it."
    );
  });

  it("uses the singular noun for a selection of one", () => {
    expect(bulkRemovalChoice({ ...faq, count: 1, sharedCount: 0 }).title).toBe(
      "Delete 1 FAQ?"
    );
    expect(
      bulkRemovalChoice({
        noun: "website",
        deleteLabel: "Delete websites",
        deleteEffect: "The websites and every page crawled from them go.",
        count: 3,
        sharedCount: 0,
      }).title
    ).toBe("Delete 3 websites?");
  });
});
