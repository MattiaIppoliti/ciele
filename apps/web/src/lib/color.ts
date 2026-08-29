/**
 * Color conversions for the widget-style color picker.
 *
 * Deliberately dependency-free: the repo ships neither the `color` package nor
 * a slider primitive, so the math lives here in plain TS, which is also the
 * only layer vitest picks up (`src/**\/*.test.ts`, no `.tsx`).
 *
 * HSV (not HSL) is the interaction model, because the saturation/value square
 * maps to it directly. Alpha is carried as a 0–100 percentage alongside it.
 */

export type Hsv = { h: number; s: number; v: number; a: number };

export type ColorFormat = "hex" | "rgb" | "css" | "hsl";

export const COLOR_FORMATS: ColorFormat[] = ["hex", "rgb", "css", "hsl"];

export const clamp = (n: number, min: number, max: number) =>
  Math.min(max, Math.max(min, n));

export function hsvToRgb({ h, s, v }: Hsv): [number, number, number] {
  const sn = s / 100;
  const vn = v / 100;
  const c = vn * sn;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = vn - c;
  const [r, g, b] =
    h < 60
      ? [c, x, 0]
      : h < 120
        ? [x, c, 0]
        : h < 180
          ? [0, c, x]
          : h < 240
            ? [0, x, c]
            : h < 300
              ? [x, 0, c]
              : [c, 0, x];
  return [
    Math.round((r + m) * 255),
    Math.round((g + m) * 255),
    Math.round((b + m) * 255),
  ];
}

export function rgbToHsv(r: number, g: number, b: number, a = 100): Hsv {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : (d / max) * 100;
  const v = max * 100;
  return { h, s, v, a };
}

/** HSV → HSL, both hue-preserving; returns rounded `[h, s, l]`. */
export function hsvToHsl({ h, s, v }: Hsv): [number, number, number] {
  const sn = s / 100;
  const vn = v / 100;
  const l = vn * (1 - sn / 2);
  const sl = l === 0 || l === 1 ? 0 : (vn - l) / Math.min(l, 1 - l);
  return [Math.round(h), Math.round(sl * 100), Math.round(l * 100)];
}

const hex2 = (n: number) => n.toString(16).padStart(2, "0");

/**
 * Serializes to `#RRGGBB`, or `#RRGGBBAA` when the color is translucent, so a
 * fully opaque color round-trips through storage unchanged.
 */
export function hsvToHex(hsv: Hsv): string {
  const [r, g, b] = hsvToRgb(hsv);
  const alpha = clamp(Math.round(hsv.a), 0, 100);
  const suffix = alpha >= 100 ? "" : hex2(Math.round((alpha / 100) * 255));
  return `#${hex2(r)}${hex2(g)}${hex2(b)}${suffix}`.toUpperCase();
}

/** Accepts `#rgb` / `#rgba` / `#rrggbb` / `#rrggbbaa`; null if unparseable. */
export function hexToHsv(hex: string): Hsv | null {
  let h = hex.trim().replace(/^#/, "");
  if (h.length === 3 || h.length === 4)
    h = h
      .split("")
      .map((c) => c + c)
      .join("");
  if (!/^[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(h)) return null;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const a = h.length === 8 ? (parseInt(h.slice(6, 8), 16) / 255) * 100 : 100;
  return rgbToHsv(r, g, b, Math.round(a));
}

/** The read-only text shown for a given output format. */
export function formatColor(hsv: Hsv, format: ColorFormat): string {
  const [r, g, b] = hsvToRgb(hsv);
  switch (format) {
    case "hex":
      return hsvToHex(hsv);
    case "rgb":
      return `${r}, ${g}, ${b}`;
    case "css":
      return `rgba(${r}, ${g}, ${b}, ${(clamp(hsv.a, 0, 100) / 100).toFixed(2)})`;
    case "hsl": {
      const [h, s, l] = hsvToHsl(hsv);
      return `${h}, ${s}%, ${l}%`;
    }
  }
}
