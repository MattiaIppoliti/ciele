import { describe, expect, it } from "vitest";
import { unsavedEdits } from "./improvement-edits";

const saved = { title: "Refund policy", description: "Wrong window" };

describe("unsavedEdits", () => {
  it("is null when the fields match what was saved", () => {
    expect(unsavedEdits(saved, { ...saved })).toBeNull();
  });

  it("sends a trimmed title and an unchanged description stays out", () => {
    expect(unsavedEdits(saved, { ...saved, title: "  Refunds  " })).toEqual({
      title: "Refunds",
    });
  });

  it("ignores whitespace-only title changes and a blank title", () => {
    expect(unsavedEdits(saved, { ...saved, title: " Refund policy " })).toBeNull();
    expect(unsavedEdits(saved, { ...saved, title: "   " })).toBeNull();
  });

  it("sends the description verbatim, including clearing it", () => {
    expect(unsavedEdits(saved, { ...saved, description: "" })).toEqual({
      description: "",
    });
  });

  it("combines both fields into one patch", () => {
    expect(
      unsavedEdits(saved, { title: "Refunds", description: "30 days" }),
    ).toEqual({ title: "Refunds", description: "30 days" });
  });
});
