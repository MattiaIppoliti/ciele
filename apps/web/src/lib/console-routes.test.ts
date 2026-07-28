import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CONSOLE_PATH_PREFIXES, isConsolePath } from "./console-routes";

const ADMIN_GROUP = fileURLToPath(
  new URL("../app/(admin)/", import.meta.url),
);

/**
 * The console/public split gates the cookie-consent banner, so a stale list
 * would either put the banner back inside the product or drop it from a public
 * page. The first test is the one that matters: it reads the route group off
 * disk, so adding an admin section without listing it here fails the build.
 */
describe("console routes", () => {
  it("lists every top-level (admin) route segment", () => {
    const onDisk = readdirSync(ADMIN_GROUP, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => `/${entry.name}`)
      .sort();

    expect([...CONSOLE_PATH_PREFIXES].sort()).toEqual(onDisk);
  });

  it("claims the dashboard at / and every console subtree", () => {
    expect(isConsolePath("/")).toBe(true);
    expect(isConsolePath("/settings")).toBe(true);
    expect(isConsolePath("/settings/billing")).toBe(true);
    expect(isConsolePath("/assistants/abc/flows/1")).toBe(true);
  });

  it("leaves the public site, auth and the widget alone", () => {
    for (const path of [
      "/home",
      "/pricing",
      "/security",
      "/policies/cookies",
      "/contact/sales",
      "/login",
      "/signup",
      "/join/token",
      "/widget/abc",
    ]) {
      expect(isConsolePath(path)).toBe(false);
    }
  });

  it("does not match a public path that merely starts like a console one", () => {
    expect(isConsolePath("/insights-report")).toBe(false);
    expect(isConsolePath("/setup-guide")).toBe(false);
  });
});
