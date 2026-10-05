import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CATALOG_GROUPS, COMPONENT_FAMILIES, componentFamily, catalogPath } from "./catalog";
import { GET } from "@/app/(component-library)/components/[slug]/source/route";

const root = resolve(process.cwd(), "../..");

describe("component library source contract", () => {
  it("serves only registered component families, including for path-like input", async () => {
    for (const slug of ["unknown", "../../package.json", "buttons/../inputs"]) {
      expect(componentFamily(slug)).toBeUndefined();
      const response = await GET(new Request("https://ciele.app/components/unknown/source"), { params: Promise.resolve({ slug }) });
      expect(response.status).toBe(404);
    }
  });

  it("keeps routes unique and every family in a navigation category", () => {
    const slugs = COMPONENT_FAMILIES.map((family) => family.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const family of COMPONENT_FAMILIES) {
      expect(family.slug).toMatch(/^[a-z]+(?:-[a-z]+)*$/);
      expect(["component", "block"]).toContain(family.kind);
      expect(CATALOG_GROUPS).toContain(family.group);
      expect(family.variants.length).toBeGreaterThan(0);
      expect(family.sources.length).toBeGreaterThan(0);
      expect(family.usage).toContain("import ");
      for (const path of family.sources) {
        expect(path).not.toContain("..");
        expect(path).toMatch(/^(packages\/(ui|charts)\/src|apps\/web\/src\/(components|lib))\//);
        expect(path).not.toMatch(/\/actions\.|\/ee\//);
      }
    }
  });

  it("keeps composed features in Blocks and individual form controls in Components", () => {
    for (const slug of ["tables", "motion-table", "availability-scheduler", "appearance-settings", "conversation", "chat-composer", "editors"]) {
      const family = componentFamily(slug);
      expect(family?.kind).toBe("block");
      expect(family && catalogPath(family)).toBe(`/components/blocks/${slug}`);
    }
    for (const slug of ["labels", "field-header", "section-heading", "inputs", "checkboxes", "switches", "charts"]) {
      const family = componentFamily(slug);
      expect(family?.kind).toBe("component");
      expect(family && catalogPath(family)).toBe(`/components/${slug}`);
    }
    const paths = COMPONENT_FAMILIES.map(catalogPath);
    expect(new Set(paths).size).toBe(paths.length);
    expect(paths).not.toContain("/components/blocks");
  });

  it("returns the exact implementation for every published code tab", async () => {
    for (const family of COMPONENT_FAMILIES) {
      const response = await GET(new Request(`https://ciele.app/components/${family.slug}/source`), { params: Promise.resolve({ slug: family.slug }) });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ files: family.sources.map((path) => ({ path, code: readFileSync(resolve(root, path), "utf8") })) });
    }
  });

  it("preserves the autonomous Overview and Insights blocks on their canonical routes", () => {
    const dedicated = COMPONENT_FAMILIES.filter((family) => family.preview === "block");
    expect(dedicated).toHaveLength(19);
    for (const family of dedicated) {
      expect(family.kind).toBe("block");
      expect(catalogPath(family)).toBe(`/components/blocks/${family.slug}`);
      expect(family.sources.some((path) => path.endsWith("-dashboard.tsx") || path.endsWith("assistant-overview.tsx"))).toBe(false);
    }
    expect(componentFamily("activity")?.usage).toContain("OverviewActivity");
    expect(componentFamily("usage")?.sources).toContain("apps/web/src/components/insights/insights-chart.tsx");
    expect(componentFamily("latency")?.variants).toEqual(["Distribution", "Trend", "Empty"]);
    expect(componentFamily("rate-cards")?.variants).toContain("Autonomy gauge");
  });

  it("catalogs every shared primitive and app-level UI/motion presentation file", () => {
    const sources = new Set(COMPONENT_FAMILIES.flatMap((family) => family.sources));
    const directories = ["packages/ui/src", "apps/web/src/components/ui", "apps/web/src/components/motion"];
    const missing = directories.flatMap((directory) => readdirSync(resolve(root, directory))
      .filter((file) => file.endsWith(".tsx"))
      .map((file) => `${directory}/${file}`)
      .filter((path) => !sources.has(path)));
    expect(missing).toEqual([]);
    for (const file of ["component-part", "model-source-select", "model-allow-list", "identity-gate"]) {
      expect(sources.has(`apps/web/src/components/chat/${file}.tsx`)).toBe(true);
    }
  });
});
