import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { ROLL_ENTRANCE_ROWS, RollInText, rollsInAt } from "./roll-in-text";

describe("rollsInAt", () => {
  it("rolls the first ten rows in and renders the rest plainly", () => {
    expect(ROLL_ENTRANCE_ROWS).toBe(10);
    expect(rollsInAt(0)).toBe(true);
    expect(rollsInAt(9)).toBe(true);
    expect(rollsInAt(10)).toBe(false);
    expect(rollsInAt(250)).toBe(false);
  });
});

it("keeps Scritto enabled inside table cells when entrance is disabled", () => {
  const html = renderToStaticMarkup(
    createElement(Table, null,
      createElement(TableBody, null,
        createElement(TableRow, null,
          createElement(TableCell, null, createElement(RollInText, { text: "Updated title", entrance: false })),
        ),
      ),
    ),
  );
  expect(html).toContain('<scritto-text role="img" aria-label="Updated title">Updated title</scritto-text>');
});
