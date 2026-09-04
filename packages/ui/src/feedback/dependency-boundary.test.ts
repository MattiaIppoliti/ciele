import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Only this package may depend on the two libraries. A second importer would
 * be a second sound design, and a second place to forget the gesture gate.
 */
const ROOT = join(__dirname, "..", "..", "..", "..");
const GROUPS = ["apps", "packages", join("ee", "apps")];
const LIBS = ["@foleyjs/core", "@foleyjs/react", "web-haptics"];

function workspaceManifests(): { name: string; deps: Set<string> }[] {
  const out: { name: string; deps: Set<string> }[] = [];
  for (const group of GROUPS) {
    const dir = join(ROOT, group);
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir)) {
      const manifest = join(dir, entry, "package.json");
      if (!existsSync(manifest)) continue;
      const pkg = JSON.parse(readFileSync(manifest, "utf8")) as {
        name?: string;
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
        peerDependencies?: Record<string, string>;
      };
      out.push({
        name: pkg.name ?? entry,
        deps: new Set([
          ...Object.keys(pkg.dependencies ?? {}),
          ...Object.keys(pkg.devDependencies ?? {}),
          ...Object.keys(pkg.peerDependencies ?? {}),
        ]),
      });
    }
  }
  return out;
}

describe("feedback dependency boundary", () => {
  const manifests = workspaceManifests();

  it("sees the workspaces at all", () => {
    expect(manifests.length).toBeGreaterThan(5);
  });

  it("lets only @agent-hub/ui depend on the sound and haptics libraries", () => {
    const importers = manifests
      .filter((m) => LIBS.some((lib) => m.deps.has(lib)))
      .map((m) => m.name)
      .sort();
    expect(importers).toEqual(["@agent-hub/ui"]);
  });
});
