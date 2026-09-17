import { describe, expect, it } from "vitest";
import { listInputText, parseListInput, sameList } from "./list-input";

describe("parseListInput", () => {
  it("splits on the separators a Member actually types", () => {
    expect(parseListInput("ann@x.edu, bob@x.edu")).toEqual(["ann@x.edu", "bob@x.edu"]);
    expect(parseListInput("ann@x.edu; bob@x.edu")).toEqual(["ann@x.edu", "bob@x.edu"]);
    expect(parseListInput("ann@x.edu bob@x.edu")).toEqual(["ann@x.edu", "bob@x.edu"]);
  });

  it("drops the empties a half-typed separator leaves behind", () => {
    expect(parseListInput("ann@x.edu, ")).toEqual(["ann@x.edu"]);
    expect(parseListInput("  ")).toEqual([]);
    expect(parseListInput("")).toEqual([]);
  });

  it("keeps an option's inner spaces when only commas separate", () => {
    expect(parseListInput("Option one, Option two", ",")).toEqual(["Option one", "Option two"]);
  });
});

describe("listInputText", () => {
  it("renders a stored list as the text a Member would have typed", () => {
    expect(listInputText(["a", "b"])).toBe("a, b");
    expect(listInputText([])).toBe("");
    expect(listInputText(undefined)).toBe("");
  });

  it("round-trips: parsing its own output gives the same list", () => {
    const values = ["ann@x.edu", "bob@x.edu"];
    expect(parseListInput(listInputText(values))).toEqual(values);
  });
});

describe("sameList", () => {
  it("is true only for the same values in the same order", () => {
    expect(sameList(["a", "b"], ["a", "b"])).toBe(true);
    expect(sameList(["a", "b"], ["b", "a"])).toBe(false);
    expect(sameList(["a"], ["a", "b"])).toBe(false);
    expect(sameList(undefined, [])).toBe(true);
  });

  // The point of the whole seam: a keystroke that parses to the list already
  // held must NOT be treated as an outside change, or the field resets itself
  // and the separator can never be typed (only pasted).
  it("treats a trailing separator as no change to the list", () => {
    const held = ["ann@x.edu"];
    expect(sameList(parseListInput("ann@x.edu, "), held)).toBe(true);
  });
});
