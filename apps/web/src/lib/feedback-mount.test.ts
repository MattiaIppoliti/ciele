import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Where interface sounds (#817) are mounted, and where they are not.
 *
 * The provider is mounted per segment rather than at the root, so what makes
 * a surface silent is that nothing above it mounts one. The embedded widget
 * now mounts its own (two chat cues, decided after the spec), which is
 * precisely why the root must stay bare: the auth pages, the onboarding flow
 * and anything else outside these segments are silent by construction, not by
 * a flag someone can flip.
 *
 * Asserted from the filesystem, the way loading-coverage is: this is a fact
 * about the layout tree, and rendering it would prove less.
 */
const APP_DIR = join(__dirname, "..", "app");
const PROVIDER = "FeedbackProvider";

function layoutMountsProvider(segment: string): boolean {
  const file = join(APP_DIR, segment, "layout.tsx");
  if (!existsSync(file)) return false;
  return readFileSync(file, "utf8").includes(PROVIDER);
}

describe("feedback provider placement", () => {
  it("is mounted in the admin route group", () => {
    expect(layoutMountsProvider("(admin)")).toBe(true);
  });

  it("is mounted in the marketing route group", () => {
    expect(layoutMountsProvider("(marketing)")).toBe(true);
  });

  it("is mounted for the embedded widget, and by the widget's own layout", () => {
    expect(layoutMountsProvider("widget")).toBe(true);
  });

  it("is never in the root layout", () => {
    // The root is what every other surface inherits, so a provider here would
    // silently sound the auth pages and any segment added later.
    expect(layoutMountsProvider("")).toBe(false);
  });
});
