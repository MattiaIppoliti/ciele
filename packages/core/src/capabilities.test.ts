import { describe, expect, it } from "vitest";
import {
  BUILTIN_ROLE_KEYS,
  CAPABILITIES,
  CAPABILITY_CATALOG,
  assistantLevelCapabilities,
  builtinRoleDefaults,
  capabilitiesAllow,
  capabilitiesRelyingOn,
  capabilityTier,
  effectiveAssistantCapabilities,
  intersectCapabilities,
  isAssistantLevelCapability,
  isEditedBuiltin,
  isOwnerOnlyCapability,
  roleTierFor,
  withRequiredCapabilities,
} from "./capabilities";
import { memberRoleRank, roleAllowsCapability } from "./teammate-grants";
import type { Role } from "./types";

const LADDER: Role[] = ["owner", "admin", "editor", "support_agent", "viewer"];

const tierRank = (tier: string) =>
  ({ member: 1, operate: 1, edit: 2, publish: 3, manageMembers: 3, manageApiKeys: 3, changeRoles: 4 })[tier]!;

describe("the Capability catalogue", () => {
  it("names every Capability area:action, once", () => {
    expect(new Set(CAPABILITIES).size).toBe(CAPABILITIES.length);
    for (const id of CAPABILITIES) expect(id).toMatch(/^[a-z][A-Za-z]*:[a-z][A-Za-z]*$/);
  });

  it("requires only Capabilities that exist and sit no higher than the one requiring them", () => {
    // A requirement above its dependent would make some built-in's defaults
    // hold a Capability without the one it relies on.
    for (const entry of CAPABILITY_CATALOG) {
      for (const required of entry.requires) {
        expect(CAPABILITIES, `${entry.id} requires ${required}`).toContain(required);
        expect(tierRank(capabilityTier(required as never))).toBeLessThanOrEqual(tierRank(entry.tier));
      }
    }
  });

  it("marks exactly the Owner rung Owner-only", () => {
    expect(CAPABILITIES.filter(isOwnerOnlyCapability)).toEqual(["personalSubscriptions:manage"]);
  });
});

describe("built-in Role defaults", () => {
  it("give each ladder Role exactly what its rung reached, so nobody gains or loses on migration", () => {
    for (const role of LADDER) {
      const held = new Set(builtinRoleDefaults(role));
      for (const id of CAPABILITIES) {
        expect(held.has(id), `${role} / ${id}`).toBe(roleAllowsCapability(role, capabilityTier(id)));
      }
    }
  });

  it("are closed over their requirements", () => {
    for (const key of BUILTIN_ROLE_KEYS) {
      const defaults = builtinRoleDefaults(key);
      expect(withRequiredCapabilities(defaults)).toEqual(defaults);
    }
  });

  it("derive back to the ladder Role RLS already knows", () => {
    for (const role of ["admin", "editor", "support_agent", "viewer"] as const) {
      expect(roleTierFor(builtinRoleDefaults(role))).toBe(role);
    }
    expect(roleTierFor(builtinRoleDefaults("data_viewer"))).toBe("viewer");
  });

  it("are not edited until they differ from the defaults", () => {
    expect(isEditedBuiltin("editor", builtinRoleDefaults("editor"))).toBe(false);
    expect(isEditedBuiltin("editor", builtinRoleDefaults("editor").filter((id) => id !== "flows:delete"))).toBe(true);
  });
});

describe("roleTierFor", () => {
  it("is the highest tier among the Capabilities", () => {
    expect(roleTierFor([])).toBe("viewer");
    expect(roleTierFor(["inbox:view", "inbox:operate"])).toBe("support_agent");
    expect(roleTierFor(["inbox:operate", "flows:edit"])).toBe("editor");
    expect(roleTierFor(["assistants:publish"])).toBe("admin");
    expect(memberRoleRank(roleTierFor(["apiKeys:manage"]))).toBe(3);
  });

  it("never derives Owner, even from every Capability", () => {
    expect(roleTierFor(CAPABILITIES)).toBe("admin");
  });
});

describe("dependencies", () => {
  it("turns on what a Capability relies on, transitively", () => {
    expect(withRequiredCapabilities(["flows:edit"])).toEqual(["assistants:view", "flows:view", "flows:edit"]);
  });

  it("names the selected Capabilities that keep one on", () => {
    const selected = ["assistants:view", "flows:view", "flows:edit", "inbox:view"];
    expect(capabilitiesRelyingOn("assistants:view", selected)).toEqual(["flows:view", "flows:edit"]);
    expect(capabilitiesRelyingOn("flows:edit", selected)).toEqual([]);
  });
});

describe("checking", () => {
  it("lets member through and checks everything else by name", () => {
    expect(capabilitiesAllow(null, "member")).toBe(true);
    expect(capabilitiesAllow(["flows:edit"], "flows:edit")).toBe(true);
    expect(capabilitiesAllow(new Set(["flows:view"]), "flows:edit")).toBe(false);
    expect(capabilitiesAllow(undefined, "flows:view")).toBe(false);
  });

  it("keeps only the Assistant-level Capabilities for an Assistant assignment", () => {
    expect(assistantLevelCapabilities(["flows:edit", "members:manage", "inbox:view"])).toEqual(["flows:edit", "inbox:view"]);
  });

  it("intersects in catalogue order", () => {
    expect(intersectCapabilities(["flows:edit", "inbox:view"], ["inbox:view", "flows:edit", "audit:view"])).toEqual(["flows:edit", "inbox:view"]);
  });
});

describe("effectiveAssistantCapabilities", () => {
  const viewer = builtinRoleDefaults("viewer");
  const admin = builtinRoleDefaults("admin");

  it("raises an Organization Viewer on the one Assistant they edit", () => {
    const caps = effectiveAssistantCapabilities({ base: viewer, isOwner: false, scope: "all", override: { role: "editor" } });
    expect(caps).toContain("flows:edit");
    expect(caps).not.toContain("members:view");
  });

  it("lowers an Admin to a custom Role on one Assistant, keeping Organization work", () => {
    const caps = effectiveAssistantCapabilities({
      base: admin,
      isOwner: false,
      scope: "all",
      override: { role: "viewer", capabilities: ["assistants:view", "inbox:view", "members:manage"] },
    });
    expect(caps).toContain("members:manage");
    expect(caps).toContain("inbox:view");
    expect(caps).not.toContain("flows:view");
    expect(caps).not.toContain("assistants:edit");
  });

  it("holds nothing Assistant-level where denied or not selected, and never limits an Owner", () => {
    for (const [scope, override] of [["all", { role: "denied" }], ["selected", null]] as const) {
      const caps = effectiveAssistantCapabilities({ base: admin, isOwner: false, scope, override });
      expect(caps.some(isAssistantLevelCapability)).toBe(false);
    }
    expect(effectiveAssistantCapabilities({ base: CAPABILITIES, isOwner: true, scope: "selected", override: { role: "denied" } })).toEqual([...CAPABILITIES]);
  });

  it("keeps a key under its own Role on the Assistant", () => {
    const caps = effectiveAssistantCapabilities({ base: viewer, isOwner: false, scope: "all", override: { role: "admin" }, ceiling: viewer });
    expect(caps).not.toContain("flows:edit");
  });
});
