import { describe, expect, it } from "vitest";
import { activeToken, matchByName, replaceToken } from "./token";

describe("activeToken", () => {
  it("finds the token the caret is inside", () => {
    expect(activeToken("hi @sa", 6, "@")).toEqual({ start: 3, query: "sa" });
    expect(activeToken("/quo", 4, "/")).toEqual({ start: 0, query: "quo" });
  });

  it("opens only at the start, a line, or after whitespace", () => {
    // The whole reason the gate exists: an address is not a mention, and the
    // slash in "and/or" is not a command.
    expect(activeToken("mail me@example.com", 19, "@")).toBeNull();
    expect(activeToken("and/or", 6, "/")).toBeNull();
    expect(activeToken("one\n@sa", 7, "@")).toEqual({ start: 4, query: "sa" });
  });

  it("closes at a newline", () => {
    expect(activeToken("@sam\nand then", 13, "@")).toBeNull();
  });

  it("closes once the query runs long, so prose stops reopening it", () => {
    expect(activeToken(`@${"x".repeat(33)}`, 34, "@")).toBeNull();
    expect(activeToken(`@${"x".repeat(32)}`, 33, "@")).not.toBeNull();
  });

  it("reads the token behind the caret, not the whole text", () => {
    expect(activeToken("@sam and @ad", 4, "@")).toEqual({
      start: 0,
      query: "sam",
    });
  });

  it("returns null with no trigger at all", () => {
    expect(activeToken("plain words", 11, "@")).toBeNull();
  });
});

describe("replaceToken", () => {
  // The replacement's own trailing space lands beside whatever already
  // followed the caret; picking mid-sentence is how the channel picker has
  // always behaved, and the caret still sits right after the inserted name.
  it("swaps the token for the replacement and moves the caret after it", () => {
    const token = { start: 3, query: "sa" };
    expect(replaceToken("hi @sa there", token, 6, "@Sam ")).toEqual({
      text: "hi @Sam  there",
      caret: 8,
    });
  });

  it("lets a replacement be the whole message, with no trailing space", () => {
    const token = { start: 0, query: "quote" };
    expect(replaceToken("/quote", token, 6, "Write me a quote")).toEqual({
      text: "Write me a quote",
      caret: 16,
    });
  });

  it("keeps whatever sat after the caret", () => {
    const token = { start: 0, query: "" };
    expect(replaceToken("@ rest", token, 1, "@Ada ")).toEqual({
      text: "@Ada  rest",
      caret: 5,
    });
  });
});

describe("matchByName", () => {
  const items = [
    { name: "Ada", kind: "member" },
    { name: "Sam", kind: "teammate" },
    { name: "Casandra", kind: "member" },
  ];

  it("offers everything for an empty query", () => {
    expect(matchByName(items, "").map((i) => i.name)).toHaveLength(3);
  });

  it("filters case-insensitively on a substring", () => {
    expect(matchByName(items, "AS").map((i) => i.name)).toEqual(["Casandra"]);
  });

  // Every one of the three contains an "a"; only Ada starts with one.
  it("puts a prefix match above a substring match", () => {
    expect(matchByName(items, "a").map((i) => i.name)).toEqual([
      "Ada",
      "Sam",
      "Casandra",
    ]);
  });

  it("honours priority above prefix", () => {
    const ranked = matchByName(items, "a", (i) =>
      i.kind === "teammate" ? 0 : 1
    );
    // Sam only substring-matches, and still outranks Ada's prefix match.
    expect(ranked.map((i) => i.name)).toEqual(["Sam", "Ada", "Casandra"]);
  });

  it("drops an unnamed item rather than offering a blank row", () => {
    expect(matchByName([{ name: "  " }, { name: "Ada" }], "")).toEqual([
      { name: "Ada" },
    ]);
  });
});
