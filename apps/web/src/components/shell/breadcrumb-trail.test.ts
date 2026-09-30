import { describe, expect, it } from "vitest";
import { breadcrumbTrail } from "@/components/shell/breadcrumb-trail";

const labels = (path: string, detail?: string) =>
  breadcrumbTrail(path, detail).map((crumb) => crumb.label);

describe("breadcrumbTrail", () => {
  it("is one crumb on a section page", () => {
    expect(labels("/inbox")).toEqual(["Inbox"]);
    expect(labels("/")).toEqual(["Assistants"]);
  });

  it("adds a step for a detail page and links the section", () => {
    const trail = breadcrumbTrail("/help-desks/abc");
    expect(trail.map((c) => c.label)).toEqual(["Help Desks", "Desk"]);
    expect(trail[0]!.href).toBe("/help-desks");
    expect(trail[1]!.href).toBeUndefined();
  });

  it("uses the page's own name for the last step", () => {
    expect(labels("/help-desks/abc", "Central Support")).toEqual([
      "Help Desks",
      "Central Support",
    ]);
  });

  it("does not rename a section page", () => {
    expect(labels("/help-desks", "Central Support")).toEqual(["Help Desks"]);
  });

  it("walks the Library down to a document", () => {
    expect(labels("/library/files/s1/d1")).toEqual([
      "Library",
      "Files",
      "Source",
      "Document",
    ]);
  });

  it("scopes an assistant section and its nested flow", () => {
    const trail = breadcrumbTrail("/assistants/a1/flows/new");
    expect(trail.map((c) => c.label)).toEqual(["Flows", "New flow"]);
    expect(trail[0]!.href).toBe("/assistants/a1/flows");
  });

  it("puts a skill under Tools & Skills, new or existing", () => {
    const created = breadcrumbTrail("/assistants/a1/tools/skills/new");
    expect(created.map((c) => c.label)).toEqual(["Tools & Skills", "New skill"]);
    expect(created[0]!.href).toBe("/assistants/a1/tools");
    expect(labels("/assistants/a1/tools/skills/s1")).toEqual(["Tools & Skills", "Skill"]);
  });
});

describe("breadcrumbTrail depth", () => {
  it("names an unknown deep route from its segments", () => {
    expect(labels("/insights/costs/breakdown/a1b2c3d4")).toEqual([
      "Insights",
      "Costs",
      "Breakdown",
      "Details",
    ]);
  });

  it("links every step but the last", () => {
    const trail = breadcrumbTrail("/insights/costs/breakdown/a1b2c3d4");
    expect(trail.map((c) => c.href)).toEqual([
      "/insights",
      "/insights/costs",
      "/insights/costs/breakdown",
      undefined,
    ]);
  });
});
