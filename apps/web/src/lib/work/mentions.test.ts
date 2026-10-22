import { describe, expect, it } from "vitest";
import { parseMentionTokens } from "@agent-hub/core";
import { decodeMentions, encodeMentions, insertMention, mentionCandidates, mentionQuery } from "./mentions";

describe("typing a mention", () => {
  it("finds the @query right before the caret", () => {
    expect(mentionQuery("Ping @ad", 8)).toEqual({ start: 5, query: "ad" });
    expect(mentionQuery("@", 1)).toEqual({ start: 0, query: "" });
    expect(mentionQuery("mail me at a@b", 14)).toBeNull();
    expect(mentionQuery("Ping @ada now", 13)).toBeNull();
  });

  it("replaces the query with the name and moves the caret past it", () => {
    expect(insertMention("Ping @ad please", 5, 8, "Ada Lovelace")).toEqual({ text: "Ping @Ada Lovelace  please", caret: 19 });
  });
});

describe("storing mentions as ids", () => {
  const ada = { id: "u-ada", name: "Ada Lovelace" };
  const al = { id: "u-al", name: "Ada" };

  it("encodes picked names as tokens, longer names first", () => {
    const body = encodeMentions("@Ada Lovelace and @Ada, see this", [al, ada]);
    expect(body).toBe("@[Ada Lovelace](member:u-ada) and @[Ada](member:u-al), see this");
    expect(parseMentionTokens(body)).toEqual(["u-ada", "u-al"]);
  });

  it("leaves a name that was not picked, or was deleted, as text", () => {
    expect(encodeMentions("hi @Grace", [ada])).toBe("hi @Grace");
    expect(encodeMentions("email ada@example.com", [{ id: "u", name: "example" }])).toBe("email ada@example.com");
  });

  it("decodes a stored body under each Member's current name", () => {
    const decoded = decodeMentions("ask @[Ada](member:u-ada) twice @[Ada](member:u-ada)", (id) => (id === "u-ada" ? "Ada King" : null));
    expect(decoded.text).toBe("ask @Ada King twice @Ada King");
    expect(decoded.picked).toEqual([{ id: "u-ada", name: "Ada King" }]);
    // And back: the same ids, so a rename never breaks a mention.
    expect(parseMentionTokens(encodeMentions(decoded.text, decoded.picked))).toEqual(["u-ada"]);
  });
});

describe("who can be mentioned", () => {
  const people = [
    { userId: "me", name: "Me Myself", email: "me@x.io", role: "editor" as const },
    { userId: "ada", name: "Ada Lovelace", email: "ada@x.io", role: "editor" as const },
    { userId: "bob", name: "Bob Stone", email: "bob@x.io", role: "viewer" as const },
    { userId: "boss", name: "Grace Admin", email: "grace@x.io", role: "admin" as const },
  ];

  it("offers the Project's readers, never the writer", () => {
    const open = { visibility: "organization" as const, createdBy: "me" };
    expect(mentionCandidates(people, open, [], "", "me").map((p) => p.userId)).toEqual(["ada", "bob", "boss"]);
    const closed = { visibility: "private" as const, createdBy: "me" };
    expect(mentionCandidates(people, closed, ["ada"], "", "me").map((p) => p.userId)).toEqual(["ada", "boss"]);
  });

  it("matches the start of any name part or the email", () => {
    const open = { visibility: "organization" as const, createdBy: null };
    expect(mentionCandidates(people, open, [], "love", "me").map((p) => p.userId)).toEqual(["ada"]);
    expect(mentionCandidates(people, open, [], "grace", "me").map((p) => p.userId)).toEqual(["boss"]);
    expect(mentionCandidates(people, open, [], "zz", "me")).toEqual([]);
  });
});
