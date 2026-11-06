import { describe, expect, it } from "vitest";
import { capabilitiesForLadderRole, type Role } from "@agent-hub/core";
import { can, canManageMembers } from "./rbac";

const access = (role: Role) => ({ role, capabilities: capabilitiesForLadderRole(role) });

describe("console gates (ADR-0028)", () => {
  it("ask the Capability, the same check the server makes", () => {
    expect(can(access("admin"), "apiKeys:manage")).toBe(true);
    expect(can(access("editor"), "apiKeys:manage")).toBe(false);
    expect(can(access("editor"), "flows:edit")).toBe(true);
    expect(can({ role: "editor", capabilities: ["flows:view"] }, "flows:edit")).toBe(false);
    expect(can(null, "member")).toBe(false);
    expect(can(access("viewer"), "member")).toBe(true);
  });

  it("keep the Settings rail on the Organization tier", () => {
    expect(canManageMembers("admin")).toBe(true);
    expect(canManageMembers("editor")).toBe(false);
    expect(canManageMembers(null)).toBe(false);
  });
});
