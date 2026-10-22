import { describe, expect, it } from "vitest";
import { breadcrumbTrail, documentTitle } from "@/components/shell/breadcrumb-trail";

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

  it("names a Project by the page and keeps its view in the tabs (#1053)", () => {
    expect(labels("/projects/prj_1/list", "Website relaunch")).toEqual(["Projects", "Website relaunch"]);
    expect(labels("/tasks/tsk_1", "Write the brief")).toEqual(["All tasks", "Write the brief"]);
    expect(labels("/tasks/timeline")).toEqual(["All tasks", "Timeline"]);
    expect(labels("/my-tasks")).toEqual(["My Tasks"]);
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

describe("documentTitle (#1073)", () => {
  const title = (path: string, detail?: string, assistant?: string) =>
    documentTitle(breadcrumbTrail(path, detail), path, assistant);

  it("names a section page once", () => {
    expect(title("/inbox")).toBe("Inbox · Ciele");
    expect(title("/my-tasks")).toBe("My Tasks · Ciele");
  });

  it("puts the page before its section, so a tab strip shows what differs", () => {
    expect(title("/tasks/tsk_1", "Write the brief")).toBe("Write the brief · All tasks · Ciele");
  });

  it("differs between two pages of one section, so the route announcer speaks", () => {
    expect(title("/tasks/timeline")).not.toBe(title("/tasks"));
  });

  it("carries the record's id until the page names it, so moving between two records is announced", () => {
    const pending = (path: string) => documentTitle(breadcrumbTrail(path), path, null, false);
    expect(pending("/tasks/tsk_1")).toBe("Task tsk_1 · All tasks · Ciele");
    expect(pending("/tasks/tsk_1")).not.toBe(pending("/tasks/tsk_2"));
    expect(pending("/projects/prj_1/list")).toBe("List · Project prj_1 · Projects · Ciele");
    // Pages without a record, and SETUP sections, are unchanged.
    expect(pending("/tasks/timeline")).toBe(title("/tasks/timeline"));
    expect(documentTitle(breadcrumbTrail("/assistants/a1/general"), "/assistants/a1/general", "Admissions", false)).toBe(
      "General · Admissions · Ciele"
    );
  });

  it("names a Project's open tab, so switching tabs is announced", () => {
    expect(title("/projects/prj_1/list", "Website relaunch")).toBe("List · Website relaunch · Projects · Ciele");
    expect(title("/projects/prj_1/board", "Website relaunch")).toBe("Board · Website relaunch · Projects · Ciele");
    expect(title("/projects/prj_1/views/v1", "Website relaunch")).toBe(
      "Saved view · Website relaunch · Projects · Ciele"
    );
    expect(title("/projects")).toBe("Projects · Ciele");
  });

  it("names the Assistant a SETUP section belongs to", () => {
    expect(title("/assistants/a1/general", undefined, "Admissions")).toBe("General · Admissions · Ciele");
    expect(title("/assistants/a2/general", undefined, "Library help")).toBe("General · Library help · Ciele");
    expect(title("/assistants/a1/flows/new", undefined, "Admissions")).toBe("New flow · Flows · Admissions · Ciele");
    expect(title("/assistants/a1", undefined, "Admissions")).toBe("Overview · Admissions · Ciele");
  });

  it("names no Assistant outside one, nor one the shell has not loaded", () => {
    expect(title("/setup/general", undefined, "Admissions")).toBe("General · Ciele");
    expect(title("/assistants/a1/general")).toBe("General · Ciele");
  });
});
