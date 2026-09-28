import { describe, expect, it } from "vitest";
import { assistantsUrlStateFromSearchParams } from "./assistants-url-state";

describe("assistants dashboard URL state", () => {
  it("defaults to recent activity in a grid", () => {
    expect(assistantsUrlStateFromSearchParams({})).toEqual({
      q: "",
      sort: "updated",
      view: "grid",
    });
  });

  it("reads a search, order and layout from the link", () => {
    expect(
      assistantsUrlStateFromSearchParams({ q: "support", sort: "name", view: "list" }),
    ).toEqual({ q: "support", sort: "name", view: "list" });
  });

  it("ignores a hand-edited value that is not an option", () => {
    expect(assistantsUrlStateFromSearchParams({ sort: "size", view: "table" })).toMatchObject({
      sort: "updated",
      view: "grid",
    });
  });
});
