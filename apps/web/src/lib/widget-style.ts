import type { WidgetCorner, WidgetStyle } from "@agent-hub/core";

/**
 * One place that turns a stored {@link WidgetStyle} (every field optional,
 * possibly written before a field existed) into the effective values the
 * widget surfaces render. The launcher script (`public/widget.js`) cannot
 * import this, it is a dependency-free classic script, so it carries the same
 * defaults inline; this module is the one the app code and the tests use, and
 * the numbers below are the contract both sides follow.
 */

export const WIDGET_STYLE_DEFAULTS = {
  brandColor: "#0a0a0a",
  headerColor: "", // empty = the chat's own themed header
  bubbleColor: "", // empty = brand color
  buttonColor: "", // empty = brand color
  focusRingColor: "", // empty = brand color
  showOnMobile: true,
  buttonSize: 56,
  buttonRadius: 100,
  paddingBottom: 24,
  paddingRight: 24,
  corner: "bottom-right" as WidgetCorner,
  fontFamily: "",
  fontSize: 14,
  windowWidth: 380,
  windowHeight: 640,
} as const;

/** Bounds that keep a typo from producing an unusable widget. */
export const WIDGET_STYLE_LIMITS = {
  buttonSize: { min: 32, max: 120 },
  buttonRadius: { min: 0, max: 100 },
  padding: { min: 0, max: 200 },
  fontSize: { min: 12, max: 20 },
  windowWidth: { min: 280, max: 800 },
  windowHeight: { min: 320, max: 1200 },
  /** Uploaded icons: dimension cap enforced at pick time. */
  iconPx: 200,
  /** Data-URL byte cap: icons ride the style JSON into every Publication. */
  iconBytes: 64 * 1024,
} as const;

export interface ResolvedWidgetStyle {
  brandColor: string;
  /** Empty string = no override, keep the surface's own theme. */
  headerColor: string;
  bubbleColor: string;
  buttonColor: string;
  focusRingColor: string;
  launcherIcon: string | null;
  closeIcon: string | null;
  showOnMobile: boolean;
  buttonSize: number;
  buttonRadius: number;
  paddingBottom: number;
  paddingRight: number;
  corner: WidgetCorner;
  fontFamily: string;
  fontSize: number;
  windowWidth: number;
  windowHeight: number;
}

const clampNum = (
  value: number | undefined,
  fallback: number,
  { min, max }: { min: number; max: number }
) =>
  typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, Math.round(value)))
    : fallback;

/**
 * Effective style: defaults filled in, numbers clamped, the legacy
 * `position` honored when the four-corner `corner` was never set, and the
 * three chat colors falling back to the brand color so an Assistant styled
 * before the full Style section renders exactly as it used to.
 */
export function resolveWidgetStyle(
  style: WidgetStyle | undefined | null
): ResolvedWidgetStyle {
  const s = style ?? {};
  const d = WIDGET_STYLE_DEFAULTS;
  const L = WIDGET_STYLE_LIMITS;
  const brandColor = s.brandColor || d.brandColor;
  const corner: WidgetCorner =
    s.corner ?? (s.position === "left" ? "bottom-left" : d.corner);
  return {
    brandColor,
    headerColor: s.headerColor || d.headerColor,
    bubbleColor: s.bubbleColor || brandColor,
    buttonColor: s.buttonColor || brandColor,
    focusRingColor: s.focusRingColor || brandColor,
    launcherIcon: s.launcherIcon || null,
    closeIcon: s.closeIcon || null,
    showOnMobile: s.showOnMobile ?? d.showOnMobile,
    buttonSize: clampNum(s.buttonSize, d.buttonSize, L.buttonSize),
    buttonRadius: clampNum(s.buttonRadius, d.buttonRadius, L.buttonRadius),
    paddingBottom: clampNum(s.paddingBottom, d.paddingBottom, L.padding),
    paddingRight: clampNum(s.paddingRight, d.paddingRight, L.padding),
    corner,
    fontFamily: s.fontFamily || d.fontFamily,
    fontSize: clampNum(s.fontSize, d.fontSize, L.fontSize),
    windowWidth: clampNum(s.windowWidth, d.windowWidth, L.windowWidth),
    windowHeight: clampNum(s.windowHeight, d.windowHeight, L.windowHeight),
  };
}

/** Google Fonts stylesheet URL for a family, or null when none is picked. */
export function googleFontHref(family: string): string | null {
  const f = family.trim();
  if (!f) return null;
  return (
    "https://fonts.googleapis.com/css2?family=" +
    encodeURIComponent(f).replace(/%20/g, "+") +
    ":wght@400;500;600;700&display=swap"
  );
}
