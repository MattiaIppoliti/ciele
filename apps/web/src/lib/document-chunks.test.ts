import { describe, expect, it } from "vitest";
import {
  chunkLabel,
  chunkPreview,
  chunkWordCount,
  filterChunks,
  pageForChunkIndex,
} from "./document-chunks";

describe("chunkLabel", () => {
  it("numbers from one, padded to two digits", () => {
    expect(chunkLabel(0)).toBe("01");
    expect(chunkLabel(8)).toBe("09");
    expect(chunkLabel(9)).toBe("10");
    // Past ninety-nine it grows rather than truncating.
    expect(chunkLabel(120)).toBe("121");
  });
});

describe("chunkWordCount", () => {
  it("counts whitespace-separated runs", () => {
    expect(chunkWordCount("one two three")).toBe(3);
    expect(chunkWordCount("  padded \n words\t here ")).toBe(3);
    expect(chunkWordCount("")).toBe(0);
    expect(chunkWordCount("   ")).toBe(0);
  });
});

describe("pageForChunkIndex", () => {
  it("maps an index onto the page that holds it", () => {
    expect(pageForChunkIndex(0, 50)).toBe(1);
    expect(pageForChunkIndex(49, 50)).toBe(1);
    expect(pageForChunkIndex(50, 50)).toBe(2);
    expect(pageForChunkIndex(399, 50)).toBe(8);
    // Defensive: a negative index is page one, not page zero.
    expect(pageForChunkIndex(-3, 50)).toBe(1);
  });
});

describe("filterChunks", () => {
  const chunks = [{ text: "Leave expires" }, { text: "Public holidays" }];

  it("matches a substring, ignoring case", () => {
    expect(filterChunks(chunks, "LEAVE")).toEqual([{ text: "Leave expires" }]);
    expect(filterChunks(chunks, "day")).toEqual([{ text: "Public holidays" }]);
  });

  it("restores everything when cleared", () => {
    expect(filterChunks(chunks, "")).toEqual(chunks);
    expect(filterChunks(chunks, "   ")).toEqual(chunks);
  });

  it("returns nothing rather than everything when nothing matches", () => {
    expect(filterChunks(chunks, "zzz")).toEqual([]);
  });
});

describe("chunkPreview", () => {
  it("flattens and cuts on a word boundary", () => {
    expect(chunkPreview("one\ntwo   three")).toBe("one two three");
    expect(chunkPreview("alpha beta gamma", 12)).toBe("alpha beta…");
  });
});
