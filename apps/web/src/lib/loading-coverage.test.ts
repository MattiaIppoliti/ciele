import { readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every route segment with a `page.tsx` must have a `loading.tsx`.
 *
 * Without one, the router holds the *previous* page on screen until the server
 * answers, so the click that started the navigation looks like it did nothing.
 * The boundary is the only thing that makes a slow navigation legible, and it
 * is trivially easy to add a route and forget it, which is how 26 of 45 console
 * segments ended up bare.
 *
 * This is a gate rather than a convention because a convention did not hold:
 * the skeleton is a one-liner over `components/route-skeleton.tsx`, so the cost
 * of satisfying this test is a four-line file.
 */

const APP_DIR = join(__dirname, "..", "app");

function segments(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (!statSync(full).isDirectory()) continue;
    if (entry === "node_modules") continue;
    found.push(full, ...segments(full));
  }
  return found;
}

function has(dir: string, file: string): boolean {
  try {
    return statSync(join(dir, file)).isFile();
  } catch {
    return false;
  }
}

const allSegments = [APP_DIR, ...segments(APP_DIR)];
const pages = allSegments.filter((d) => has(d, "page.tsx"));
const loadings = new Set(allSegments.filter((d) => has(d, "loading.tsx")));

/** A `loading.tsx` on an ancestor segment also covers its descendants. */
function coveringBoundary(segment: string): string | null {
  let current = segment;
  for (;;) {
    if (loadings.has(current)) return current;
    if (current === APP_DIR) return null;
    const parent = join(current, "..");
    if (parent === current) return null;
    current = parent;
  }
}

const rel = (p: string) => relative(APP_DIR, p).split(sep).join("/") || "(root)";

describe("loading.tsx coverage", () => {
  it("finds the app router's pages at all", () => {
    // Guards the walk itself: a broken path would make every assertion below
    // pass vacuously, which is the one way this gate could silently stop working.
    expect(pages.length).toBeGreaterThan(50);
  });

  it("gives every page its OWN loading boundary", () => {
    // Not merely an inherited one. Inheritance would make this gate toothless
    // exactly where it matters: `(admin)/loading.tsx` covers every console
    // route, so a new segment would pass while showing a skeleton shaped like
    // the dashboard. Own boundary = a skeleton that matches the page.
    const bare = pages.filter((p) => !loadings.has(p)).map(rel);
    expect(bare).toEqual([]);
  });

  it("never leaves a page with only an inherited boundary", () => {
    // Same rule stated from the other side, so a failure names the ancestor
    // that was silently standing in.
    const inherited = pages
      .filter((p) => !loadings.has(p))
      .map((p) => `${rel(p)} (covered only by ${rel(coveringBoundary(p) ?? p)})`);
    expect(inherited).toEqual([]);
  });

  it("has no loading.tsx left behind by a deleted route", () => {
    // When a route is removed, its boundary has to go too, or Next keeps a
    // segment alive with a skeleton and no page. That shipped once already,
    // after an upstream change deleted `(admin)/projects`.
    const orphans = [...loadings]
      .filter(
        (l) => !pages.some((p) => p === l || p.startsWith(l + sep)),
      )
      .map(rel);
    expect(orphans).toEqual([]);
  });
});
