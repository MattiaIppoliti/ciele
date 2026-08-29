import { describe, expect, it } from "vitest";
import {
  ORG_SETTINGS_TABS,
  PERSONAL_SETTINGS_HOME,
  PERSONAL_SETTINGS_TABS,
  SETTINGS_HOME,
  crossScopeLink,
  settingsScopeFromPath,
  settingsTabFromPath,
  tabsForScope,
} from "./settings-nav";

/**
 * The Settings dialog has two scopes and the split is a permission boundary:
 * Organization tabs are owner/admin only, personal tabs are everyone's. These
 * tests pin the classification and the cross-links, because getting the scope
 * wrong would either hide a person's own profile or offer tenant configuration
 * to a role that cannot have it.
 */
describe("settings navigation", () => {
  it("reads the active tab from a settings route", () => {
    expect(settingsTabFromPath("/settings/usage")).toBe("usage");
    expect(settingsTabFromPath("/settings/billing?checkout=success")).toBe(
      "billing"
    );
    expect(settingsTabFromPath("/insights")).toBeNull();
  });

  it("classifies personal routes as personal and everything else as org", () => {
    expect(settingsScopeFromPath("/settings/profile")).toBe("personal");
    for (const tab of ORG_SETTINGS_TABS) {
      expect(settingsScopeFromPath(tab.href)).toBe("organization");
    }
    // An unknown slug falls to the gated scope, never the open one.
    expect(settingsScopeFromPath("/settings/whatever")).toBe("organization");
  });

  it("each scope lists its own tabs", () => {
    expect(tabsForScope("personal")).toEqual(PERSONAL_SETTINGS_TABS);
    expect(tabsForScope("organization")).toEqual(ORG_SETTINGS_TABS);
  });

  it("each rail's footer links into the other scope", () => {
    expect(crossScopeLink("organization").href).toBe(PERSONAL_SETTINGS_HOME);
    expect(crossScopeLink("personal").href).toBe(SETTINGS_HOME);
  });

  it("both entry points land on a tab that exists", () => {
    expect(ORG_SETTINGS_TABS.map((t) => t.href)).toContain(SETTINGS_HOME);
    expect(PERSONAL_SETTINGS_TABS.map((t) => t.href)).toContain(
      PERSONAL_SETTINGS_HOME
    );
  });
});
