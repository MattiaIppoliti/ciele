import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { RouteSkeleton } from "@/components/route-skeleton";
import { AuthSkeleton } from "@/components/auth-skeleton";
import { WidgetSkeleton } from "@/components/widget/widget-skeleton";

/**
 * Renders every skeleton the 66 `loading.tsx` files delegate to.
 *
 * `tsc` proves the JSX types are sound and eslint proves the syntax is, but
 * neither runs the component. A loading boundary that throws is worse than no
 * boundary at all: it turns a slow navigation into an error page, and it would
 * only surface on whichever route happened to be slow that day.
 */

const VARIANTS = ["list", "grid", "form", "prose", "hero"] as const;

describe("RouteSkeleton", () => {
  for (const variant of VARIANTS) {
    it(`renders the ${variant} variant`, () => {
      const html = renderToStaticMarkup(createElement(RouteSkeleton, { variant }));
      expect(html).toContain("aria-busy");
      expect(html.length).toBeGreaterThan(100);
    });
  }

  it("defaults to a variant rather than rendering an empty frame", () => {
    const html = renderToStaticMarkup(createElement(RouteSkeleton, {}));
    expect(html.length).toBeGreaterThan(100);
  });

  it("drops the admin page header for the marketing-shaped variants", () => {
    // `hero` and `prose` supply their own heading; the generic title bar
    // assumes a console page header with a right-aligned action button.
    const hero = renderToStaticMarkup(
      createElement(RouteSkeleton, { variant: "hero" }),
    );
    const list = renderToStaticMarkup(
      createElement(RouteSkeleton, { variant: "list" }),
    );
    expect(hero).not.toContain("ml-auto");
    expect(list).toContain("ml-auto");
  });
});

describe("AuthSkeleton", () => {
  it("renders, and honours the field count", () => {
    const one = renderToStaticMarkup(createElement(AuthSkeleton, { fields: 1 }));
    const five = renderToStaticMarkup(createElement(AuthSkeleton, { fields: 5 }));
    expect(one).toContain("aria-busy");
    expect(five.length).toBeGreaterThan(one.length);
  });
});

describe("WidgetSkeleton", () => {
  it("renders a chat-shaped frame", () => {
    const html = renderToStaticMarkup(createElement(WidgetSkeleton));
    expect(html).toContain("aria-busy");
    // Header, transcript and composer: the three bands the real widget has, so
    // the embedded frame does not resize when the publication arrives.
    expect(html).toContain("h-svh");
  });
});
