import { describe, expect, it } from "vitest";
import { builtinRoleDefaults } from "@agent-hub/core";
import { bundleViews, heldOnBy, restrictToLevels, toggleBundle, toggleCapability } from "./role-editor";

const ORG = { organizationLevel: true };

describe("the role editor", () => {
  it("turns on what a Capability relies on", () => {
    const next = toggleCapability(new Set(), "flows:edit");
    expect([...next]).toEqual(["assistants:view", "flows:view", "flows:edit"]);
  });

  it("keeps a Capability on while another relies on it, and names that one", () => {
    const selected = new Set(["assistants:view", "flows:view", "flows:edit"]);
    expect(toggleCapability(selected, "flows:view")).toEqual(selected);
    expect(heldOnBy("flows:view", selected)).toEqual(["Create and edit Flows"]);
    expect([...toggleCapability(selected, "flows:edit")]).toEqual(["assistants:view", "flows:view"]);
  });

  it("reads a bundle as on, off or some", () => {
    const flows = (selected: Set<string>) => bundleViews(selected, ORG).find((view) => view.bundle === "Flows")!;
    expect(flows(new Set()).state).toBe("off");
    expect(flows(new Set(["flows:view"])).state).toBe("some");
    expect(flows(new Set(builtinRoleDefaults("editor"))).state).toBe("on");
  });

  it("ticks a whole bundle, and unticks it except what another bundle relies on", () => {
    const on = toggleBundle(new Set(), "Flows", ORG);
    expect(on.has("evaluations:run")).toBe(true);
    expect(on.has("assistants:view")).toBe(true);

    // apiIntegrations:view (Tools) relies on assistants:view (Assistants).
    const selected = new Set([
      "assistants:view", "assistants:chat", "assistants:edit", "assistants:delete", "assistants:publish", "apiIntegrations:view",
    ]);
    const off = toggleBundle(selected, "Assistants", ORG);
    expect([...off].sort()).toEqual(["apiIntegrations:view", "assistants:view"]);
  });

  it("searches labels, ids and bundles, dropping empty bundles", () => {
    const views = bundleViews(new Set(), { ...ORG, query: "legal" });
    expect(views.map((view) => view.bundle)).toEqual(["Inbox"]);
    expect(views[0]!.capabilities.map((capability) => capability.id)).toEqual(["inbox:legalHold"]);
  });

  it("keeps an Assistant-only Role to Assistant-level Capabilities", () => {
    const views = bundleViews(new Set(), { organizationLevel: false });
    const members = views.find((view) => view.bundle === "Members and access");
    expect(members?.selected ?? 0).toBe(0);
    const restricted = restrictToLevels(new Set(["flows:edit", "flows:view", "assistants:view", "members:view"]), { organizationLevel: false });
    expect([...restricted].sort()).toEqual(["assistants:view", "flows:edit", "flows:view"]);
  });
});
