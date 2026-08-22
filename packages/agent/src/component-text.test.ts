import { describe, expect, it } from "vitest";
import { componentPartText } from "./component-text";
import type { ChatReplyPart } from "./types";

type ComponentPart = Extract<ChatReplyPart, { type: "component" }>;

function table(props: Record<string, unknown>): ComponentPart {
  return {
    type: "component",
    action: "search_knowledge",
    name: "table",
    callId: "c1",
    props,
  };
}

/**
 * The flattening the Inbox export depends on: an answer that referred to a
 * table must not export as prose pointing at nothing.
 */
describe("componentPartText", () => {
  it("flattens a table to its heading, header row and rows", () => {
    expect(
      componentPartText(
        table({
          title: "Piani",
          columns: ["Piano", "Prezzo"],
          rows: [
            ["Base", "9"],
            ["Pro", "29"],
          ],
          caption: "IVA esclusa",
        })
      )
    ).toBe("Piani\nPiano | Prezzo\nBase | 9\nPro | 29\nIVA esclusa");
  });

  it("omits the optional lines it was not given", () => {
    expect(
      componentPartText(table({ columns: ["A"], rows: [["1"]] }))
    ).toBe("A\n1");
  });

  it("pads a short row so the columns still line up", () => {
    expect(
      componentPartText(table({ columns: ["A", "B"], rows: [["only"]] }))
    ).toBe("A | B\nonly | ");
  });

  it("contributes nothing rather than a placeholder when props are unusable", () => {
    expect(componentPartText(table({}))).toBe("");
    expect(componentPartText(table({ columns: "not-a-list" }))).toBe("");
  });
});
