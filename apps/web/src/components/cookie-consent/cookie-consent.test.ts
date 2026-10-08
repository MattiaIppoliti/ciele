import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({ pathname: "/", segments: ["(marketing)", "home"] }));
vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
  useSelectedLayoutSegments: () => navigation.segments,
}));
vi.mock("next/dynamic", () => ({ default: () => () => "consent-banner" }));

import { CookieConsent } from "./cookie-consent";

describe("consent on the shared root URL", () => {
  it.each([
    ["/", ["(marketing)", "home"], true],
    ["/home", ["(marketing)", "home"], true],
    ["/", ["(admin)"], false],
    ["/insights", ["(admin)", "insights"], false],
    ["/widget/a1", ["widget", "a1"], false],
  ])("renders the banner on %s only for a public first-party page", (pathname, segments, visible) => {
    navigation.pathname = pathname;
    navigation.segments = segments;
    expect(renderToStaticMarkup(createElement(CookieConsent))).toBe(visible ? "consent-banner" : "");
  });
});
