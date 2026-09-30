import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement, type ComponentType } from "react";
import { beforeAll, describe, expect, it } from "vitest";

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

/**
 * The first import pays for transforming the whole shared graph (the skeletons,
 * `@agent-hub/ui`, the motion primitives); every later one hits the cache. Done
 * inside the first case, that cost was charged to one test's 15s timeout, and
 * under a parallel turbo run it went over. Warmed up front instead, with a
 * budget sized for a cold start. `allSettled`, so a module that throws on
 * import still fails its own case and nobody else's.
 */
const COLD_IMPORT_TIMEOUT_MS = 120_000;

describe("every loading.tsx", () => {
  beforeAll(() => Promise.allSettled(files.map((file) => import(file))), COLD_IMPORT_TIMEOUT_MS);

  it("was found", () => {
    expect(files.length).toBeGreaterThan(50);
  });

  for (const file of files) {
    it(`renders ${relative(APP_DIR, file)}`, async () => {
      const { default: Loading } = (await import(file)) as { default: ComponentType };
      const html = renderToStaticMarkup(createElement(Loading));
      // A boundary with nothing in it reads as a blank screen, not a load.
      expect(html.length).toBeGreaterThan(50);
      expect(html).toContain("aria-busy");
    });
  }
});
