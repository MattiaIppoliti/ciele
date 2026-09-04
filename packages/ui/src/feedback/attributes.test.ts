import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Button } from "../button";
import { PRESS_ATTR, RELEASE_ATTR } from "./runtime";

/**
 * The shared Button is how every page gets press feedback without per-page
 * work, so the attribute is asserted on its markup rather than assumed.
 */
describe("Button feedback attributes", () => {
  it("carries press and release", () => {
    const html = renderToStaticMarkup(createElement(Button, null, "Save"));
    expect(html).toContain(`${PRESS_ATTR}=""`);
    expect(html).toContain(`${RELEASE_ATTR}=""`);
  });

  it("keeps them when rendered as a link", () => {
    const html = renderToStaticMarkup(
      createElement(Button, { render: createElement("a", { href: "/x" }) }, "Go"),
    );
    expect(html).toContain("<a");
    expect(html).toContain(`${PRESS_ATTR}=""`);
  });
});
