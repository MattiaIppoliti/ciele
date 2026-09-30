import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every Settings tab has its re-export under the `@modal` slot.
 *
 * A soft click on Settings intercepts into `@modal/(.)settings/<tab>`, so the
 * page underneath stays mounted. A tab with no re-export there does not fail:
 * the click falls through to the full page and the modal silently closes, so
 * nothing but this test notices a new tab that forgot it.
 */

const ADMIN = join(__dirname, "..", "app", "(admin)");
const SETTINGS = join(ADMIN, "settings");
const MODAL = join(ADMIN, "@modal", "(.)settings");

const tabs = readdirSync(SETTINGS).filter(
  (entry) =>
    statSync(join(SETTINGS, entry)).isDirectory() && existsSync(join(SETTINGS, entry, "page.tsx"))
);

describe("the Settings modal", () => {
  it("finds the tabs", () => {
    expect(tabs.length).toBeGreaterThan(5);
  });

  it.each(tabs)("re-exports the %s tab's page and loading boundary", (tab) => {
    for (const file of ["page.tsx", "loading.tsx"]) {
      if (!existsSync(join(SETTINGS, tab, file))) continue;
      const reExport = join(MODAL, tab, file);
      expect(existsSync(reExport), `${tab}/${file}`).toBe(true);
      expect(readFileSync(reExport, "utf8")).toContain(
        `export { default } from "../../../settings/${tab}/${file.replace(".tsx", "")}";`
      );
    }
  });
});
