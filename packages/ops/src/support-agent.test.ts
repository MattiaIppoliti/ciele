import { describe, expect, it } from "vitest";
import { capabilityTier, memberRoleRank, roleAllowsCapability } from "@agent-hub/core";
import { DEMO_MEMBER, DEMO_ORG, getMockDb } from "@agent-hub/db";
import type { OperationContext } from "./operation";
import { createOrgApiKeyOp } from "./organization";
import { operationsByName } from "./platform-actions";

/**
 * The Support Agent Role (#1086) is not a rung on the ladder: it ranks as a
 * Viewer in every comparison, and the one thing it adds goes through the named
 * `operate` check. These cases pin that against every operation the package
 * exports, so a new `edit`-or-higher operation cannot let it through by
 * accident.
 */
describe("the Support Agent Role", () => {
  it("ranks as a Viewer", () => {
    expect(memberRoleRank("support_agent")).toBe(memberRoleRank("viewer"));
  });

  it("is refused by every edit-or-higher operation and allowed every member read", () => {
    const refusedByLadder = new Set(["edit", "publish", "manageMembers", "manageApiKeys", "changeRoles"]);
    const operations = operationsByName();
    expect(operations.length).toBeGreaterThan(100);
    for (const op of operations) {
      const allowed = roleAllowsCapability("support_agent", capabilityTier(op.capability));
      if (refusedByLadder.has(capabilityTier(op.capability))) expect(allowed, op.name).toBe(false);
      else if (capabilityTier(op.capability) === "member") expect(allowed, op.name).toBe(true);
      // The capability it answers Visitors through, and nothing else.
      else if (capabilityTier(op.capability) === "operate") expect(allowed, op.name).toBe(true);
      // Same verdict as a Viewer for anything else.
      else expect(allowed, op.name).toBe(roleAllowsCapability("viewer", capabilityTier(op.capability)));
    }
  });

  it("takes over, replies and releases through operate, which a Viewer does not have", () => {
    const names = operationsByName()
      .filter((op) => capabilityTier(op.capability) === "operate")
      .map((op) => op.name)
      .sort();
    expect(names).toEqual([
      "inbox.conversations.release",
      "inbox.conversations.reply",
      "inbox.conversations.takeover",
      "operators.status.set",
    ]);
    expect(roleAllowsCapability("viewer", "operate")).toBe(false);
  });

  it("caps a Support Agent API key at a creator who may answer Visitors", async () => {
    const context = (role: OperationContext["role"]): OperationContext => ({
      organizationId: DEMO_ORG.id,
      userId: DEMO_MEMBER.userId,
      role,
      db: getMockDb(),
      ports: {},
    });
    const minted = await createOrgApiKeyOp.run(context("admin"), { name: "Desk bot", role: "support_agent" });
    expect(minted.apiKey.role).toBe("support_agent");
    // A key's Role never exceeds its creator's: a Support Agent cannot hand
    // out an Editor key, and the minting itself is an admin act.
    await expect(
      createOrgApiKeyOp.run(context("support_agent"), { name: "Escalate", role: "editor" })
    ).rejects.toThrow(/cannot exceed/);
    expect(roleAllowsCapability("support_agent", capabilityTier(createOrgApiKeyOp.capability))).toBe(false);
  });
});
