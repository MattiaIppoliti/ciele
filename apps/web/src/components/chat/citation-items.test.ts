import { describe, expect, it } from "vitest";
import { toCitationItems, type CitationSource } from "./citation-items";

function source(over: Partial<CitationSource> = {}): CitationSource {
  return {
    conceptId: "concept-cv",
    conceptTitle: "Alex's CV",
    collectionName: "Library",
    sourceName: "cv.pdf",
    url: null,
    ...over,
  } as CitationSource;
}

describe("toCitationItems", () => {
  // The bug this exists for: retrieval returns chunks, several chunks of one
  // Concept is a normal good search, and the id is the Concept's.
  it("keeps one row per Concept when several chunks cite the same one", () => {
    const items = toCitationItems([source(), source(), source()]);
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe("concept-cv");
  });

  it("keeps the order retrieval chose, first occurrence winning", () => {
    const items = toCitationItems([
      source({ conceptId: "b", conceptTitle: "Second" }),
      source({ conceptId: "a", conceptTitle: "First" }),
      source({ conceptId: "b", conceptTitle: "Second again" }),
    ]);
    expect(items.map((i) => i.id)).toEqual(["b", "a"]);
    expect(items[0].title).toBe("Second");
  });

  it("gives every produced row a unique key", () => {
    const items = toCitationItems([
      source({ conceptId: "a" }),
      source({ conceptId: "a" }),
      source({ conceptId: undefined }),
      source({ conceptId: undefined }),
    ]);
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
  });

  // Two citations that name no Concept are two different things, not one
  // repeated: they are positional, so they must not fold together.
  it("keeps separate rows for sources with no Concept id", () => {
    const items = toCitationItems([
      source({ conceptId: undefined, conceptTitle: "One" }),
      source({ conceptId: undefined, conceptTitle: "Two" }),
    ]);
    expect(items).toHaveLength(2);
  });

  it("labels a row with its Collection, and its Source when there is one", () => {
    expect(toCitationItems([source()])[0].domain).toBe("Library · cv.pdf");
    expect(
      toCitationItems([source({ sourceName: null })])[0].domain
    ).toBe("Library");
  });

  it("prefers the Concept's own URL over the surface's resolver", () => {
    const items = toCitationItems(
      [source({ url: "https://example.com/cv" })],
      () => "/download"
    );
    expect(items[0].url).toBe("https://example.com/cv");
  });

  it("falls back to the surface's resolver, and to nothing without one", () => {
    expect(toCitationItems([source()], () => "/download")[0].url).toBe(
      "/download"
    );
    expect(toCitationItems([source()])[0].url).toBeUndefined();
  });
});
