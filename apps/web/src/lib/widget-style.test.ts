import { describe, expect, it } from "vitest";
import {
  WIDGET_STYLE_DEFAULTS,
  googleFontHref,
  resolveWidgetStyle,
} from "./widget-style";

describe("resolveWidgetStyle", () => {
  it("resolves an empty style to the shipped defaults", () => {
    const r = resolveWidgetStyle(undefined);
    expect(r.brandColor).toBe(WIDGET_STYLE_DEFAULTS.brandColor);
    expect(r.corner).toBe("bottom-right");
    expect(r.buttonSize).toBe(56);
    expect(r.buttonRadius).toBe(100);
    expect(r.windowWidth).toBe(380);
    expect(r.windowHeight).toBe(640);
    expect(r.fontSize).toBe(14);
    expect(r.showOnMobile).toBe(true);
    expect(r.launcherIcon).toBeNull();
    expect(r.closeIcon).toBeNull();
  });

  it("falls the three chat colors back to the brand color", () => {
    const r = resolveWidgetStyle({ brandColor: "#123456" });
    expect(r.bubbleColor).toBe("#123456");
    expect(r.buttonColor).toBe("#123456");
    expect(r.focusRingColor).toBe("#123456");
    // headerColor deliberately does not: empty means "keep the themed header".
    expect(r.headerColor).toBe("");
  });

  it("lets a specific color win over the brand fallback", () => {
    const r = resolveWidgetStyle({
      brandColor: "#123456",
      bubbleColor: "#07155F",
      buttonColor: "#AA0000",
    });
    expect(r.bubbleColor).toBe("#07155F");
    expect(r.buttonColor).toBe("#AA0000");
  });

  it("maps the legacy position onto a corner unless corner is set", () => {
    expect(resolveWidgetStyle({ position: "left" }).corner).toBe("bottom-left");
    expect(resolveWidgetStyle({ position: "right" }).corner).toBe(
      "bottom-right"
    );
    expect(
      resolveWidgetStyle({ position: "left", corner: "top-right" }).corner
    ).toBe("top-right");
  });

  it("clamps numeric fields into their limits", () => {
    const r = resolveWidgetStyle({
      buttonSize: 9999,
      buttonRadius: -5,
      paddingBottom: 100000,
      fontSize: 1,
      windowWidth: 10,
      windowHeight: 99999,
    });
    expect(r.buttonSize).toBe(120);
    expect(r.buttonRadius).toBe(0);
    expect(r.paddingBottom).toBe(200);
    expect(r.fontSize).toBe(12);
    expect(r.windowWidth).toBe(280);
    expect(r.windowHeight).toBe(1200);
  });

  it("ignores non-finite numbers", () => {
    const r = resolveWidgetStyle({ buttonSize: Number.NaN });
    expect(r.buttonSize).toBe(56);
  });
});

describe("googleFontHref", () => {
  it("is null with no family", () => {
    expect(googleFontHref("")).toBeNull();
    expect(googleFontHref("  ")).toBeNull();
  });

  it("encodes a family with spaces the way Google Fonts expects", () => {
    expect(googleFontHref("Host Grotesk")).toBe(
      "https://fonts.googleapis.com/css2?family=Host+Grotesk:wght@400;500;600;700&display=swap"
    );
  });
});
