import { describe, expect, it } from "vitest";
import { filterQuickTexts, insertQuickText, slashQueryAt } from "./quick-texts";

const texts = [
  { title: "Greeting", folder: "Openers" },
  { title: "Refund policy", folder: "Billing" },
  { title: "Reset password", folder: "Accounts" },
  { title: "Café hours", folder: null },
];

describe("filterQuickTexts", () => {
  it("filters by title as the Member types, case-insensitively", () => {
    // Title-prefix matches first (by folder), then the ones that contain it.
    expect(filterQuickTexts(texts, "re").map((t) => t.title)).toEqual([
      "Reset password",
      "Refund policy",
      "Greeting",
    ]);
    expect(filterQuickTexts(texts, "GREET").map((t) => t.title)).toEqual(["Greeting"]);
  });

  it("matches every word, ignoring accents", () => {
    expect(filterQuickTexts(texts, "password reset").map((t) => t.title)).toEqual(["Reset password"]);
    expect(filterQuickTexts(texts, "cafe").map((t) => t.title)).toEqual(["Café hours"]);
  });

  it("lists everything for an empty query, title-prefix matches first", () => {
    expect(filterQuickTexts(texts, "")).toHaveLength(4);
    expect(filterQuickTexts(texts, "po").map((t) => t.title)).toEqual(["Refund policy"]);
  });
});

describe("the / trigger", () => {
  it("opens on a slash at the start or after a space", () => {
    expect(slashQueryAt("/gre", 4)).toEqual({ query: "gre", start: 0 });
    expect(slashQueryAt("Hi /ref", 7)).toEqual({ query: "ref", start: 3 });
  });

  it("does not open inside a word or a URL", () => {
    expect(slashQueryAt("and/or", 6)).toBeNull();
    expect(slashQueryAt("see https://example.com/help", 28)).toBeNull();
    expect(slashQueryAt("/line\nnext", 10)).toBeNull();
  });

  it("inserts the body where the query was, leaving the rest editable", () => {
    const draft = "Hi /gre there";
    const slash = slashQueryAt(draft, 7)!;
    expect(insertQuickText(draft, slash, 7, "Hello Dana!")).toEqual({ text: "Hi Hello Dana! there", cursor: 14 });
  });
});
