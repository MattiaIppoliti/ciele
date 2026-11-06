import { describe, expect, it } from "vitest";
import { assistantAccessRank } from "./assistant-access";

describe("assistantAccessRank", () => {
  it("keeps an Owner's rank whatever the rows say", () => {
    expect(assistantAccessRank({ orgRole: "owner", override: "denied", scope: "selected" })).toBe(4);
  });

  it("lets an override raise or lower the org Role", () => {
    expect(assistantAccessRank({ orgRole: "viewer", override: "admin", scope: "all" })).toBe(3);
    expect(assistantAccessRank({ orgRole: "admin", override: "viewer", scope: "all" })).toBe(1);
    expect(assistantAccessRank({ orgRole: "editor", override: "denied", scope: "all" })).toBe(0);
  });

  it("hides an Assistant with no row from a Member limited to selected ones", () => {
    expect(assistantAccessRank({ orgRole: "admin", override: null, scope: "selected" })).toBe(0);
    expect(assistantAccessRank({ orgRole: "admin", override: "editor", scope: "selected" })).toBe(2);
    expect(assistantAccessRank({ orgRole: "editor", override: null, scope: "all" })).toBe(2);
    expect(assistantAccessRank({ orgRole: null, override: "admin", scope: "all" })).toBe(0);
  });
});
