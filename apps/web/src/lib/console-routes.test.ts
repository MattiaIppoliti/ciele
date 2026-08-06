import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CONSOLE_PATH_PREFIXES,
  MARKETING_PATH_PREFIXES,
  isConsolePath,
  isMarketingPath,
} from "./console-routes";

const ADMIN_GROUP = fileURLToPath(
  new URL("../app/(admin)/", import.meta.url),
);

const MARKETING_GROUP = fileURLToPath(
  new URL("../app/(marketing)/", import.meta.url),
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
      "/enterprise",
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

/**
 * The marketing list drives the auth gate in `middleware.ts`: anything the
 * public home links to has to stay reachable signed-out. Reading the group off
 * disk is what keeps a new marketing section from silently landing behind
 * /login (which is exactly how /features and /enterprise did).
 */
describe("marketing routes", () => {
  it("lists every top-level (marketing) route segment", () => {
    const onDisk = readdirSync(MARKETING_GROUP, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => `/${entry.name}`)
      .sort();

    expect([...MARKETING_PATH_PREFIXES].sort()).toEqual(onDisk);
  });

  it("claims each marketing subtree", () => {
    for (const path of [
      "/features",
      "/features/flows",
      "/enterprise",
      "/pricing",
      "/security",
      "/security/gdpr",
      "/policies/privacy",
      // The landing page is in the group as well, so the whole public site
      // shares one layout.
      "/home",
    ]) {
      expect(isMarketingPath(path)).toBe(true);
    }
  });

  it("leaves the console, the root and lookalike paths alone", () => {
    for (const path of ["/", "/assistants", "/security-report", "/homepage"]) {
      expect(isMarketingPath(path)).toBe(false);
    }
  });
});
