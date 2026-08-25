import { describe, expect, it } from "vitest";
import {
  activeMention,
  insertMention,
  mentionMatches,
  type MentionTarget,
} from "./mention";

const target = (
  name: string,
  kind: "member" | "teammate",
  id = name
): MentionTarget => ({ id, name, kind, avatarSeed: id });

const ROSTER: MentionTarget[] = [
  target("Mattia Ippoliti", "member", "m-mattia"),
  target("Sam", "teammate", "t-sam"),
  target("Chief of Staff", "teammate", "t-chief"),
  target("Ada", "teammate", "t-ada"),
];

describe("activeMention", () => {
  it("opens on a bare @ at the start of the text", () => {
    expect(activeMention("@", 1)).toEqual({ start: 0, query: "" });
  });

  it("carries what was typed after the @, spaces included", () => {
    expect(activeMention("ciao @chief of", 14)).toEqual({
      start: 5,
      query: "chief of",
    });
  });

  it("only reads up to the caret, so editing mid-text works", () => {
    expect(activeMention("@ada please", 4)).toEqual({ start: 0, query: "ada" });
  });

  it("does not open inside a word, so an email address stays quiet", () => {
    expect(activeMention("mail me at ai@luiss", 19)).toBeNull();
  });

  it("closes when a newline follows the @", () => {
    expect(activeMention("@sam\nhello", 10)).toBeNull();
  });

  it("closes once the query outgrows any plausible name", () => {
    expect(activeMention(`@${"x".repeat(33)}`, 34)).toBeNull();
  });

  it("is null with no @ before the caret", () => {
    expect(activeMention("hello", 5)).toBeNull();
  });
});

describe("mentionMatches", () => {
  it("offers everybody on a bare @, teammates first", () => {
    expect(mentionMatches(ROSTER, "").map((entry) => entry.id)).toEqual([
      "t-sam",
      "t-chief",
      "t-ada",
      "m-mattia",
    ]);
  });

  it("filters case-insensitively", () => {
    expect(mentionMatches(ROSTER, "chIEf").map((entry) => entry.id)).toEqual([
      "t-chief",
    ]);
  });

  it("ranks a prefix match above a substring match", () => {
    // "a" prefixes Ada, and is merely inside Sam and Chief of Staff.
    expect(mentionMatches(ROSTER, "a").map((entry) => entry.id)).toEqual([
      "t-ada",
      "t-sam",
      "t-chief",
      "m-mattia",
    ]);
  });

  it("matches across the spaces in a name", () => {
    expect(
      mentionMatches(ROSTER, "chief of s").map((entry) => entry.id)
    ).toEqual(["t-chief"]);
  });

  it("returns nothing for a name that is not here", () => {
    expect(mentionMatches(ROSTER, "nobody")).toEqual([]);
  });

  it("never offers a blank name", () => {
    expect(mentionMatches([target("  ", "teammate", "t-blank")], "")).toEqual(
      []
    );
  });
});

describe("insertMention", () => {
  it("replaces the token with @Name and a trailing space", () => {
    const result = insertMention(
      "ciao @chi",
      { start: 5, query: "chi" },
      9,
      "Chief of Staff"
    );
    expect(result.text).toBe("ciao @Chief of Staff ");
    expect(result.caret).toBe(21);
  });

  it("keeps whatever followed the caret", () => {
    const result = insertMention(
      "@sa please",
      { start: 0, query: "sa" },
      3,
      "Sam"
    );
    expect(result.text).toBe("@Sam  please");
    expect(result.caret).toBe(5);
  });
});
