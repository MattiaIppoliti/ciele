import { describe, expect, it } from "vitest";
import {
  SCOPE_TABS,
  coveringCollectionName,
  filterByName,
  groupScopeSources,
  knowledgeScopeLabel,
  knowledgeScopeSummary,
  scopeSourceOnTab,
  type ScopeSource,
} from "./knowledge-scope";

/**
 * The Knowledge Scope derivations: what the picker groups, what it warns about,
 * and every sentence a Member reads about what their Teammate can search.
 *
 * Worth its own suite because the copy is the feature: "searches 2 collections"
 * when the Member picked two files, or a silent redundant pick, is the whole
 * difference between a scope they can trust and one they have to guess at.
 */

const source = (over: Partial<ScopeSource> = {}): ScopeSource => ({
  id: "src-1",
  name: "Handbook.pdf",
  kind: "file",
  collectionId: "col-1",
  ...over,
});

describe("groupScopeSources", () => {
  it("buckets each kind the way the Library's tabs do", () => {
    const grouped = groupScopeSources([
      source({ id: "a", kind: "website" }),
      source({ id: "b", kind: "url" }),
      source({ id: "c", kind: "file" }),
      source({ id: "d", kind: "text" }),
      source({ id: "e", kind: "faq" }),
    ]);
    expect(grouped.websites.map((s) => s.id)).toEqual(["a", "b"]);
    expect(grouped.files.map((s) => s.id)).toEqual(["c", "d"]);
    expect(grouped.faqs.map((s) => s.id)).toEqual(["e"]);
  });

  it("returns every bucket even when the Library is empty", () => {
    const grouped = groupScopeSources([]);
    expect(Object.keys(grouped).sort()).toEqual([
      "applications",
      "faqs",
      "files",
      "websites",
    ]);
  });

  it("offers Collections first, then the three Library buckets", () => {
    expect(SCOPE_TABS).toEqual([
      "collections",
      "websites",
      "files",
      "applications",
      "faqs",
    ]);
  });

  it("agrees with the per-tab predicate", () => {
    expect(scopeSourceOnTab(source({ kind: "faq" }), "faqs")).toBe(true);
    expect(scopeSourceOnTab(source({ kind: "faq" }), "files")).toBe(false);
  });
});

describe("filterByName", () => {
  it("matches case-insensitively on a substring", () => {
    const items = [source({ id: "a", name: "Refund policy" }), source({ id: "b", name: "Tuition" })];
    expect(filterByName(items, "REFUND").map((s) => s.id)).toEqual(["a"]);
  });

  it("an empty query keeps everything", () => {
    const items = [source({ id: "a" }), source({ id: "b" })];
    expect(filterByName(items, "   ")).toHaveLength(2);
  });
});

describe("coveringCollectionName", () => {
  it("names the scoped Collection that already covers an item", () => {
    expect(
      coveringCollectionName(source({ collectionId: "col-1" }), ["col-1"], [
        { id: "col-1", name: "General knowledge" },
      ])
    ).toBe("General knowledge");
  });

  it("says nothing when no scoped Collection covers it", () => {
    expect(
      coveringCollectionName(source({ collectionId: "col-2" }), ["col-1"], [
        { id: "col-1", name: "General knowledge" },
      ])
    ).toBeNull();
  });

  it("still reports coverage when the Collection's name is unknown", () => {
    // A scoped id with no row behind it is the dangling-scope case (#769);
    // saying "covered by nothing" would be the one wrong answer here.
    expect(
      coveringCollectionName(source({ collectionId: "col-9" }), ["col-9"], [])
    ).toBe("a collection in scope");
  });
});

describe("knowledgeScopeSummary", () => {
  it("says what an empty scope means rather than counting to zero", () => {
    expect(
      knowledgeScopeSummary({ collectionIds: [], sourceIds: [] })
    ).toContain("answers from its role");
  });

  it("counts each half, singular and plural", () => {
    expect(
      knowledgeScopeSummary({ collectionIds: ["a"], sourceIds: [] })
    ).toBe("Searches 1 collection, and cites what it finds.");
    expect(
      knowledgeScopeSummary({ collectionIds: [], sourceIds: ["a", "b"] })
    ).toBe("Searches 2 library items, and cites what it finds.");
  });

  it("joins the two halves when both are set", () => {
    expect(
      knowledgeScopeSummary({ collectionIds: ["a", "b"], sourceIds: ["c"] })
    ).toBe("Searches 2 collections and 1 library item, and cites what it finds.");
  });
});

describe("knowledgeScopeLabel", () => {
  const known = {
    collections: [{ id: "col-1", name: "General knowledge" }],
    sources: [source({ id: "src-1", name: "Handbook.pdf" })],
  };

  it("names both halves on the roster card", () => {
    expect(
      knowledgeScopeLabel(
        { collectionIds: ["col-1"], sourceIds: ["src-1"] },
        known
      )
    ).toBe("Knows: General knowledge, Handbook.pdf");
  });

  it("says a scope is empty rather than naming nothing", () => {
    expect(
      knowledgeScopeLabel({ collectionIds: [], sourceIds: [] }, known)
    ).toBe("Answers from its persona only, no knowledge in scope");
  });

  it("keeps a deleted entry visible, in both halves", () => {
    // The Alert (#769) is the other half of this; a card that quietly dropped
    // the id would make a broken scope look like a smaller one.
    expect(
      knowledgeScopeLabel(
        { collectionIds: ["gone"], sourceIds: ["also-gone"] },
        known
      )
    ).toBe("Knows: a deleted collection, a deleted library item");
  });
});
