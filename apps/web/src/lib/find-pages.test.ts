import { describe, expect, it } from "vitest";
import { GLOBAL_NAV, SETUP_SECTIONS } from "@/components/shell/nav";
import { ORG_SETTINGS_TABS } from "@/components/settings/settings-nav";
import { describePage, wireframeFor } from "./find-pages";

describe("describePage", () => {
  it("names console pages by where they go", () => {
    expect(describePage("/")?.topic).toBe("assistants");
    expect(describePage("/help-desks")?.topic).toBe("help_desks_page");
    expect(describePage("/inbox/conversations")?.topic).toBe("inbox");
    expect(describePage("/settings/general")?.topic).toBe("settings");
    expect(describePage("/library/websites")?.topic).toBe("library");
  });

  it("names SETUP sections and says which assistant, if any, they are scoped to", () => {
    const scoped = describePage("/assistants/abc/flows?x=1");
    expect(scoped).toMatchObject({ topic: "flows", setupSlug: "flows", assistantId: "abc" });
    const picker = describePage("/setup/help-desks");
    expect(picker).toMatchObject({
      topic: "assistant_help_desks",
      setupSlug: "help-desks",
      assistantId: null,
    });
  });

  it("matches a route and what is under it, not a route that merely starts the same", () => {
    expect(describePage("/inbox")?.topic).toBe("inbox");
    expect(describePage("/inbox/conversations")?.topic).toBe("inbox");
    expect(describePage("/inbox-x")).toBeNull();
    expect(describePage("/settingsx")).toBeNull();
  });

  it("returns null for anything it does not know", () => {
    expect(describePage("/somewhere/new")).toBeNull();
    expect(describePage("/setup/unknown")).toBeNull();
  });

  it("gives every console page and every SETUP section an entry with a blurb", () => {
    for (const item of GLOBAL_NAV) {
      const page = describePage(item.href);
      expect(page, item.label).not.toBeNull();
      expect(page!.blurb.length, item.label).toBeGreaterThan(10);
    }
    for (const section of SETUP_SECTIONS) {
      const page = describePage(`/setup/${section.slug}`);
      expect(page, section.label).not.toBeNull();
      expect(page!.setupSlug).toBe(section.slug);
    }
  });

  it("keeps the Settings shortcuts equal to the Settings dialog's own tabs", () => {
    const shortcuts = describePage("/settings/general")!.shortcuts!;
    expect(shortcuts.links).toEqual(
      ORG_SETTINGS_TABS.map((tab) => ({ title: tab.label, href: tab.href }))
    );
  });
});

describe("wireframeFor", () => {
  it("draws a workspace record by what it is", () => {
    expect(wireframeFor({ record: { kind: "conversation" }, href: "/inbox?conversation=1" })).toBe("chat");
    expect(wireframeFor({ record: { kind: "help_desk" }, href: "/help-desks/1" })).toBe("list");
  });

  it("draws a page by its registry entry and falls back to a plain detail page", () => {
    expect(wireframeFor({ record: null, href: "/improvements" })).toBe("kanban");
    expect(wireframeFor({ record: null, href: "/eval" })).toBe("list");
    expect(wireframeFor({ record: null, href: "/assistants/abc/flows" })).toBe("flow");
    expect(wireframeFor({ record: null, href: "/somewhere/new" })).toBe("detail");
  });
});
