import { describe, expect, it } from "vitest";
import { EMOJI_CATALOG, EMOJI_CATEGORIES, isReactionEmoji, searchEmoji } from "./emoji-catalog";

describe("emoji picker search", () => {
  it("offers the complete catalog across all categories", () => {
    expect(EMOJI_CATALOG.length).toBeGreaterThan(1800);
    expect(EMOJI_CATEGORIES.map((category) => category.id)).toEqual(["smileys", "people", "nature", "foods", "activity", "places", "objects", "symbols", "flags"]);
    expect(EMOJI_CATEGORIES.flatMap((category) => category.emojis)).toHaveLength(EMOJI_CATALOG.length);
  });
  it("ranks exact matches before fuzzy matches and respects multiple words", () => {
    expect(searchEmoji("red heart")[0]?.native).toBe("❤️");
    expect(searchEmoji("red haert")[0]?.native).toBe("❤️");
    expect(searchEmoji("thumbs up").some((emoji) => emoji.native === "👍")).toBe(true);
  });
  it("tolerates transposed, missing and extra characters", () => {
    for (const query of ["curoe", "cuor", "cuorre", "hearrt"]) {
      expect(searchEmoji(query).some((emoji) => emoji.native === "❤️")).toBe(true);
    }
  });
  it("supports common Italian names, accents and native emoji", () => {
    expect(searchEmoji("caffè").some((emoji) => emoji.native === "☕")).toBe(true);
    expect(searchEmoji("pollice").some((emoji) => emoji.native === "👍")).toBe(true);
    expect(searchEmoji("Italia").some((emoji) => emoji.native === "🇮🇹")).toBe(true);
    expect(searchEmoji("🚀").map((emoji) => emoji.native)).toEqual(["🚀"]);
  });
  it("handles empty search and genuine no-result queries", () => {
    expect(searchEmoji(" ")).toHaveLength(EMOJI_CATALOG.length);
    expect(searchEmoji("zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz")).toEqual([]);
  });
  it("validates all picker choices, flags and skin tones while refusing arbitrary text", () => {
    for (const emoji of EMOJI_CATALOG) expect(isReactionEmoji(emoji.native)).toBe(true);
    expect(isReactionEmoji("👍🏽")).toBe(true);
    expect(isReactionEmoji("🇮🇹")).toBe(true);
    for (const invalid of ["hello", "<script>", "👍❤️", "", null]) expect(isReactionEmoji(invalid)).toBe(false);
  });
});
