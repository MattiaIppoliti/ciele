import { describe, expect, it } from "vitest";
import {
  activeMention,
  insertMention,
  mentionMatches,
  splitMentions,
  type MentionTarget,
} from "./mention";

const target = (
  name: string,
  kind: "member" | "teammate",
  id = name
): MentionTarget => ({ id, name, kind, avatarSeed: id });

const ROSTER: MentionTarget[] = [
  target("Dana Whitfield", "member", "m-dana"),
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
    expect(activeMention("mail me at ada@example.com", 26)).toBeNull();
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
      "m-dana",
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
      "m-dana",
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

/**
 * The split a channel draws from: which runs of a message are names somebody
 * answers to, and which are just words with an @ in them. Both surfaces read
 * this, the composer to tint the name in place and the posted bubble to draw a
 * chip, so a disagreement here would show up as a chip that summons nobody.
 */
describe("splitMentions", () => {
  const kinds = (text: string) =>
    splitMentions(text, ROSTER).map((segment) =>
      segment.kind === "mention" ? `@${segment.target.name}` : segment.text
    );

  it('leaves a message with no @ as one run of prose', () => {
    expect(splitMentions('ciao', ROSTER)).toEqual([
      { kind: 'text', text: 'ciao' },
    ]);
  });

  it('splits a resolved name out of the words around it', () => {
    expect(kinds('hey @Sam can you look')).toEqual([
      'hey ',
      '@Sam',
      ' can you look',
    ]);
  });

  it('prefers the longest name, so a two-word name stays whole', () => {
    // 'Chief of Staff' must not match as 'Chief' with ' of Staff' left as prose.
    expect(kinds('@Chief of Staff ciao')).toEqual(['@Chief of Staff', ' ciao']);
  });

  it('keeps the text as typed while resolving case-insensitively', () => {
    const parts = splitMentions('@sAm hi', ROSTER);
    expect(parts[0]).toMatchObject({ kind: 'mention', text: '@sAm' });
    expect(parts[0].kind === 'mention' && parts[0].target.id).toBe('t-sam');
  });

  it('leaves a name nobody answers to as prose', () => {
    // A chip is a promise that somebody was summoned, and the runtime's own
    // resolver would find nobody here either.
    expect(kinds('@Nobody hi')).toEqual(['@Nobody hi']);
  });

  it('does not read an email address as a mention', () => {
    expect(kinds('write to sam@Sam.com')).toEqual(['write to sam@Sam.com']);
  });

  it("resolves a name at the start of a new line", () => {
    expect(kinds("first\n@Ada second")).toEqual([
      "first\n",
      "@Ada",
      " second",
    ]);
  });

  it('splits every mention in one message', () => {
    expect(kinds('@Sam and @Ada')).toEqual(['@Sam', ' and ', '@Ada']);
  });

  it('returns nothing for an empty message', () => {
    expect(splitMentions('', ROSTER)).toEqual([]);
  });

  it('is prose-only when the roster is empty', () => {
    expect(splitMentions('@Sam hi', [])).toEqual([
      { kind: 'text', text: '@Sam hi' },
    ]);
  });
});
