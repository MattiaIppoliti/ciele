import { describe, expect, it } from "vitest";
import { escapeMarkup } from "./escape";

describe("escapeMarkup", () => {
  it("escapes every character that could break out of text or an attribute", () => {
    expect(escapeMarkup(`<a href="x" title='y'>&</a>`)).toBe(
      "&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;"
    );
  });
});
