import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement, type ComponentType } from "react";
import { describe, expect, it } from "vitest";

/**
 * Server-renders every `loading.tsx` in the app, not only the shared skeletons
 * `route-skeleton.test.ts` covers.
 *
 * A boundary whose page has a shape no shared variant draws (a centred column,
 * a side rail) mirrors that page instead, so the content does not jump when it
 * streams in. Those are hand-written, and a hand-written one that throws turns
 * a slow navigation into an error page on whichever route was slow that day.
 */

const APP_DIR = join(__dirname, "..", "app");

function loadingFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) found.push(...loadingFiles(full));
    else if (entry === "loading.tsx") found.push(full);
  }
  return found;
}

const files = loadingFiles(APP_DIR);

describe("every loading.tsx", () => {
  it("was found", () => {
    expect(files.length).toBeGreaterThan(50);
  });

  for (const file of files) {
    it(`renders ${relative(APP_DIR, file)}`, async () => {
      const mod = (await import(file)) as { default: ComponentType };
      const html = renderToStaticMarkup(createElement(mod.default));
      // A boundary with nothing in it reads as a blank screen, not a load.
      expect(html.length).toBeGreaterThan(50);
      expect(html).toContain("aria-busy");
    });
  }
});
