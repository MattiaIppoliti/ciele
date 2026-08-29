import { describe, expect, it } from "vitest";
import type { Role } from "@agent-hub/core";
import { canAssignApiKeyRole, canManageApiKeys } from "./rbac";

describe("API key RBAC guards (#618)", () => {
  it("managing keys is admin and above", () => {
    expect(canManageApiKeys("owner")).toBe(true);
    expect(canManageApiKeys("admin")).toBe(true);
    expect(canManageApiKeys("editor")).toBe(false);
    expect(canManageApiKeys("viewer")).toBe(false);
    expect(canManageApiKeys(null)).toBe(false);
  });

  it("a key's role is capped at its creator's", () => {
    const roles: Role[] = ["owner", "admin", "editor", "viewer"];
    // An admin can mint up to admin, never owner.
    expect(roles.filter((r) => canAssignApiKeyRole("admin", r))).toEqual([
      "admin",
      "editor",
      "viewer",
    ]);
    // An owner can mint anything.
    expect(roles.filter((r) => canAssignApiKeyRole("owner", r))).toEqual(roles);
    // No role, no keys.
    expect(roles.some((r) => canAssignApiKeyRole(null, r))).toBe(false);
  });
});
