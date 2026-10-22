import { describe, expect, it } from "vitest";
import { roleAllowsCapability } from "@agent-hub/core";
import { MATRIX_ROLES, roleMatrix } from "./role-matrix";

describe("roleMatrix (#1074)", () => {
  const matrix = roleMatrix();

  it("asks every cell of the predicate the operations are gated on", () => {
    for (const row of matrix) {
      for (const role of MATRIX_ROLES) {
        expect(row.allowed[role]).toBe(roleAllowsCapability(role, row.capability));
      }
    }
  });

  it("names only capabilities the ladder knows, so no row is blank", () => {
    // An unknown capability is refused for everyone, Owners included.
    for (const row of matrix) expect(row.allowed.owner).toBe(true);
  });

  it("reads as a ladder: each Role can do everything the one below it can", () => {
    for (const row of matrix) {
      const cells = MATRIX_ROLES.map((role) => row.allowed[role]);
      for (let i = 1; i < cells.length; i++) if (cells[i]) expect(cells[i - 1]).toBe(true);
    }
  });

  it("keeps a Viewer to reading and an Editor short of publishing", () => {
    const allowed = (role: (typeof MATRIX_ROLES)[number]) =>
      matrix.filter((row) => row.allowed[role]).map((row) => row.capability);
    expect(allowed("viewer")).toEqual(["member"]);
    expect(allowed("editor")).toEqual(["member", "edit"]);
    expect(allowed("owner")).toContain("changeRoles");
    expect(allowed("admin")).not.toContain("changeRoles");
  });
});
