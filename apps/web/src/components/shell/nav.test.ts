import { builtinRoleDefaults, capabilitiesForLadderRole } from "@agent-hub/core";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { API_V1_DOMAINS } from "@/lib/api-v1/meta";
import { SETTINGS_API_DOMAINS } from "@/components/settings/settings-nav";
import { DOMAIN_PRESENTATION } from "@/lib/developer-panel/domains";
import {
  apiDomainsForPath,
  assistantIdFromPath,
  assistantSectionFromPath,
  GLOBAL_NAV,
  legacyAssistantSectionHref,
  navItem,
  navItemForPath,
  mayOpenPath,
  navVisibleTo,
  supportAgentMayOpen,
  setupHref,
  SETUP_SECTIONS,
} from "./nav";

const ASSISTANT_ROUTE = fileURLToPath(
  new URL("../../app/(admin)/assistants/[id]/", import.meta.url),
);

describe("Assistant navigation", () => {
  it("has a destination-owned loading boundary for every SETUP section", () => {
    const loadingPath = (slug: string) =>
      `${ASSISTANT_ROUTE}${slug}/loading.tsx`;
    const missing = SETUP_SECTIONS
      .filter((section) => !existsSync(loadingPath(section.slug)))
      .map((section) => section.slug);

    expect(missing).toEqual([]);
    for (const section of SETUP_SECTIONS) {
      expect(readFileSync(loadingPath(section.slug), "utf8")).toContain(
        `variant="${section.slug}"`,
      );
    }
  });

  it("reads the Assistant and top-level section from nested routes", () => {
    expect(assistantIdFromPath("/assistants/asst-1/flows/flow-2")).toBe("asst-1");
    expect(assistantSectionFromPath("/assistants/asst-1/flows/flow-2")).toBe(
      "flows"
    );
    expect(assistantSectionFromPath("/assistants/asst-1")).toBeNull();
  });

  it("builds canonical SETUP routes", () => {
    expect(setupHref("asst-1", "knowledge")).toBe(
      "/assistants/asst-1/knowledge"
    );
    expect(setupHref(null, "knowledge")).toBe("/setup/knowledge");
  });

  it("keeps former query-param URLs compatible", () => {
    expect(
      legacyAssistantSectionHref("asst-1", { page: "general" })
    ).toBe("/assistants/asst-1/general");
    expect(
      legacyAssistantSectionHref("asst-1", {
        page: "knowledge",
        c: "collection / one",
      })
    ).toBe("/assistants/asst-1/knowledge?c=collection%20%2F%20one");
    expect(
      legacyAssistantSectionHref("asst-1", {
        page: "flows",
        flowId: "flow / one",
      })
    ).toBe("/assistants/asst-1/flows/flow%20%2F%20one");
  });

  it("keeps overview canonical and rejects unknown sections", () => {
    expect(legacyAssistantSectionHref("asst-1", {})).toBeNull();
    expect(
      legacyAssistantSectionHref("asst-1", { page: "overview" })
    ).toBeNull();
    expect(
      legacyAssistantSectionHref("asst-1", { page: "unknown" })
    ).toBe("/assistants/asst-1");
  });
});

describe("which nav entry a route belongs to", () => {
  const id = (pathname: string) => navItemForPath(pathname)?.id ?? null;

  it("finds the entry for a page and everything under it", () => {
    expect(id("/")).toBe("assistants");
    expect(id("/assistants")).toBe("assistants");
    expect(id("/help-desks/desk-1")).toBe("help-desks");
    expect(id("/teammates/channels/ch-1")).toBe("teammates");
    expect(id("/settings/ai")).toBe("settings");
  });

  it("puts a Human review under the Inbox, where its Conversation is", () => {
    expect(id("/reviews/rv-1")).toBe("inbox");
  });

  it("matches whole segments, not a route that merely starts the same", () => {
    expect(id("/inbox-x")).toBeNull();
    expect(id("/settingsx")).toBeNull();
    expect(id("/somewhere/new")).toBeNull();
  });

  it("leaves an Assistant's own pages to its SETUP sections", () => {
    expect(id("/assistants/asst-1/flows")).toBeNull();
  });

  it("looks an entry up by id, never by its label", () => {
    expect(navItem("alerts").href).toBe("/alerts");
    expect(new Set(GLOBAL_NAV.map((item) => item.id)).size).toBe(GLOBAL_NAV.length);
  });
});

describe("Developer Panel domain claims (#754)", () => {
  // Every declaration site: the sidebar's global pages, the Assistant SETUP
  // sections, and the Settings dialog's tab routes.
  const claimed = [
    ...GLOBAL_NAV.flatMap((item) => item.apiDomains ?? []),
    ...SETUP_SECTIONS.flatMap((section) => section.apiDomains ?? []),
    ...Object.values(SETTINGS_API_DOMAINS).flat(),
  ];

  it("only claims domains this deployment advertises", () => {
    const advertised = new Set<string>(API_V1_DOMAINS);
    expect(claimed.filter((domain) => !advertised.has(domain))).toEqual([]);
  });

  it("only claims domains the panel can actually present", () => {
    // A claim with no presentation would render an untitled, tool-less panel.
    expect(
      claimed.filter((domain) => !DOMAIN_PRESENTATION[domain])
    ).toEqual([]);
  });

  it("leaves no domain undiscoverable in the UI", () => {
    // The invariant is coverage, not uniqueness: `assistants`, `knowledge` and
    // `help-desks` each have two legitimate homes, an Organization-wide page and
    // the Assistant section that scopes the same domain to one Assistant.
    const claimedSet = new Set<string>(claimed);
    expect(API_V1_DOMAINS.filter((domain) => !claimedSet.has(domain))).toEqual([]);
  });

  it("answers a Settings tab from its own claim", () => {
    expect(apiDomainsForPath("/settings/api-keys")).toEqual(["api-keys"]);
    expect(apiDomainsForPath("/settings/ai")).toEqual(["providers", "memories"]);
    // Organization settings live on the "general" tab, not a route called
    // /settings/organization. The reading is pinned here so it cannot drift
    // silently.
    expect(apiDomainsForPath("/settings/general")).toEqual(["organization"]);
    // Usage became programmatic in #853: two read-only endpoints, so the tab
    // that shows them gets the panel that explains how to call them.
    expect(apiDomainsForPath("/settings/usage")).toEqual(["usage"]);
    // Settings tabs that configure nothing programmatic still get no button.
    // Billing stays one: buying is a surface where a person confirms an amount.
    expect(apiDomainsForPath("/settings/billing")).toEqual([]);
    expect(apiDomainsForPath("/settings/profile")).toEqual([]);
  });

  it("answers an Assistant section from its own claim", () => {
    expect(apiDomainsForPath("/assistants/asst-1/flows")).toEqual(["flows", "applications", "reviews"]);
    // A nested route inside the section is still that section.
    expect(apiDomainsForPath("/assistants/asst-1/flows/flow-2")).toEqual(["flows", "applications", "reviews"]);
  });

  it("answers a global page from its nav entry, at the entry's own route", () => {
    expect(apiDomainsForPath("/help-desks")).toEqual(["help-desks"]);
    // The org knowledge hub is the Library, at /library. A claim left on the
    // old /knowledge href would keep passing the coverage test above while the
    // button vanished from the page, because next.config.ts 308s /knowledge
    // here and nobody would ever request the stale path.
    expect(apiDomainsForPath("/library")).toEqual(["knowledge"]);
  });

  it("answers nothing where a page deliberately has no programmatic surface", () => {
    expect(apiDomainsForPath("/insights")).toEqual([]);
    expect(apiDomainsForPath("/assistants/asst-1/style")).toEqual([]);
    expect(apiDomainsForPath("/assistants/asst-1/preview")).toEqual([]);
  });

  it("answers the Assistant Overview with the Assistant domain", () => {
    // Not a SETUP section, but the one page whose subject is the Assistant.
    expect(apiDomainsForPath("/assistants/asst-1")).toEqual(["assistants"]);
  });

  it("answers nothing for the setup picker, which has no Assistant in scope", () => {
    // Every snippet there would be an unsubstituted placeholder.
    expect(apiDomainsForPath("/setup/flows")).toEqual([]);
  });
});

describe("a narrowed Role's console (ADR-0028)", () => {
  const dataViewer = { role: "viewer" as const, capabilities: builtinRoleDefaults("data_viewer") };

  it("draws only the entries whose page the Role opens", () => {
    const visible = GLOBAL_NAV.filter((item) => navVisibleTo(dataViewer, item)).map((item) => item.id);
    expect(visible.sort()).toEqual(["assistants", "eval", "insights", "notifications", "settings"]);
  });

  it("shows the permission page on a direct URL to the rest", () => {
    expect(mayOpenPath(dataViewer, "/insights")).toBe(true);
    expect(mayOpenPath(dataViewer, "/")).toBe(true);
    expect(mayOpenPath(dataViewer, "/inbox")).toBe(false);
    expect(mayOpenPath(dataViewer, "/improvements")).toBe(false);
    expect(mayOpenPath({ role: "viewer", capabilities: [] }, "/assistants/a1/flows")).toBe(false);
    expect(mayOpenPath({ role: "viewer", capabilities: [] }, "/settings/profile")).toBe(true);
  });
});

describe("the Support Agent's console (#1086)", () => {
  it("shows only the entries a Support Agent works with", () => {
    const as = (role: "support_agent" | "viewer") => ({ role, capabilities: capabilitiesForLadderRole(role) });
    const visible = GLOBAL_NAV.filter((item) => navVisibleTo(as("support_agent"), item)).map((item) => item.id);
    expect(visible.sort()).toEqual(["help-desks", "inbox", "my-tasks", "notifications", "settings"]);
    // A Viewer keeps every entry: the built-in defaults change nobody's console.
    expect(GLOBAL_NAV.every((item) => navVisibleTo(as("viewer"), item))).toBe(true);
  });

  it("opens the Inbox, Reviews, Help Desks and Settings, and nothing that configures an Assistant", () => {
    for (const path of ["/inbox", "/inbox?conversation=c1", "/reviews/r1", "/help-desks/d1", "/settings/profile", "/my-tasks"]) {
      expect(supportAgentMayOpen(path.split("?")[0]!), path).toBe(true);
    }
    for (const path of ["/", "/assistants/a1/flows", "/library/websites", "/insights", "/improvements", "/teammates", "/projects", "/alerts", "/setup/general"]) {
      expect(supportAgentMayOpen(path), path).toBe(false);
    }
  });
});
