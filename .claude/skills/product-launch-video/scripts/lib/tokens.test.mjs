import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { brandRolesFromStats, ICON_FONT_PATTERN, isIconFont } from "./tokens.mjs";

const scriptsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

test("recognizes brand-specific icon font names", () => {
  assert.equal(isIconFont("vidaXLfont"), true);
  assert.equal(isIconFont("BrandGlyphFont"), true);
  assert.equal(isIconFont("Poppins"), false);
  assert.equal(isIconFont("HelveticaFont"), false);
  assert.equal(isIconFont("Airbnb Cereal Font"), false);
  assert.equal(isIconFont("SF Pro Text Font"), false);
  assert.equal(isIconFont("Uber Move Font"), false);
  assert.equal(isIconFont("Circular Std font"), false);
  assert.equal(isIconFont("brand-font"), false);
});

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

test("preserves a prominent second accent used outside interactive backgrounds", () => {
  const colors = ["#FFFFFF", "#2D1238", "#F3E62B", "#111111"];
  const stats = [
    { hex: "#FFFFFF", areaBg: 1000, maxArea: 1000 },
    { hex: "#2D1238", textCount: 4, interactiveBg: 3 },
    { hex: "#F3E62B", textCount: 3, interactiveBg: 0 },
    { hex: "#111111", textCount: 20 },
  ];

  assert.deepEqual(brandRolesFromStats(stats, colors), {
    canvas: "#FFFFFF",
    ink: "#111111",
    accent: "#F3E62B",
    accent2: "#2D1238",
  });
});
