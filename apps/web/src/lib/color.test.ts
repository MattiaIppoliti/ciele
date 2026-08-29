import { describe, expect, it } from "vitest";
import {
  type Hsv,
  formatColor,
  hexToHsv,
  hsvToHex,
  hsvToHsl,
  hsvToRgb,
  rgbToHsv,
} from "./color";

const hsv = (h: number, s: number, v: number, a = 100): Hsv => ({ h, s, v, a });

describe("hexToHsv", () => {
  it("parses 6-digit hex as fully opaque", () => {
    expect(hexToHsv("#FF0000")).toEqual(hsv(0, 100, 100));
    expect(hexToHsv("0a0a0a")).toEqual(hsv(0, 0, (10 / 255) * 100));
  });

  it("expands 3- and 4-digit shorthand", () => {
    expect(hexToHsv("#f00")).toEqual(hexToHsv("#ff0000"));
    expect(hexToHsv("#f008")).toEqual(hexToHsv("#ff000088"));
  });

  it("reads the alpha byte of an 8-digit hex as a percentage", () => {
    expect(hexToHsv("#FF000000")?.a).toBe(0);
    expect(hexToHsv("#FF000080")?.a).toBe(50);
    expect(hexToHsv("#FF0000FF")?.a).toBe(100);
  });

  it("rejects anything that is not a hex color", () => {
    for (const bad of ["", "#", "#12345", "#1234567", "rgb(1,2,3)", "#gggggg"])
      expect(hexToHsv(bad)).toBeNull();
  });
});

describe("hsvToHex", () => {
  it("stays 6-digit while opaque so stored colors round-trip unchanged", () => {
    expect(hsvToHex(hsv(0, 100, 100))).toBe("#FF0000");
    const original = "#0A0A0A";
    expect(hsvToHex(hexToHsv(original)!)).toBe(original);
  });

  it("appends the alpha byte once translucent", () => {
    expect(hsvToHex(hsv(0, 100, 100, 50))).toBe("#FF000080");
    expect(hsvToHex(hsv(0, 100, 100, 0))).toBe("#FF000000");
  });

  it("round-trips a translucent color", () => {
    const color = "#3366CC66";
    expect(hsvToHex(hexToHsv(color)!)).toBe(color);
  });
});

describe("rgb/hsv conversion", () => {
  it("round-trips the primaries", () => {
    const colors: [number, number, number][] = [
      [255, 0, 0],
      [0, 255, 0],
      [0, 0, 255],
      [18, 52, 86],
    ];
    for (const [r, g, b] of colors) {
      expect(hsvToRgb(rgbToHsv(r, g, b))).toEqual([r, g, b]);
    }
  });

  it("reports zero saturation and hue for greys", () => {
    expect(rgbToHsv(128, 128, 128)).toEqual(hsv(0, 0, (128 / 255) * 100));
  });
});

describe("hsvToHsl", () => {
  it("maps full-value full-saturation to 50% lightness", () => {
    expect(hsvToHsl(hsv(210, 100, 100))).toEqual([210, 100, 50]);
  });

  it("maps zero value to black regardless of saturation", () => {
    expect(hsvToHsl(hsv(210, 100, 0))).toEqual([210, 0, 0]);
  });
});

describe("formatColor", () => {
  const teal = hexToHsv("#00808080")!;

  it("renders each output format", () => {
    expect(formatColor(teal, "hex")).toBe("#00808080");
    expect(formatColor(teal, "rgb")).toBe("0, 128, 128");
    expect(formatColor(teal, "css")).toBe("rgba(0, 128, 128, 0.50)");
    expect(formatColor(teal, "hsl")).toBe("180, 100%, 25%");
  });
});
