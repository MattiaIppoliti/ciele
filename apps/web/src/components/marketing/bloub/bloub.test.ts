import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CLOUD_EXPRESSIONS, bloubSvgUrl } from "./index";

/**
 * The faces are files now, so nothing type-checks the list against them: a
 * renamed or deleted SVG would leave CloudAvatar fetching a 404 and a marketing
 * page with a hole in it, discovered by a visitor rather than by CI.
 */
describe("bloub faces", () => {
  const publicDir = join(import.meta.dirname, "..", "..", "..", "..", "public");

  it.each(CLOUD_EXPRESSIONS)("%s has a file under public/", (expression) => {
    const path = join(publicDir, bloubSvgUrl(expression));
    expect(existsSync(path), `missing ${path}`).toBe(true);
    const svg = readFileSync(path, "utf8").trim();
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg.endsWith("</svg>")).toBe(true);
    // The gaze group and the themed fills are the contract CloudAvatar and the
    // callout's `--bloub-*` variables rely on.
    expect(svg).toContain("bloub-gaze");
    expect(svg).toContain("--bloub-body");
  });
});
