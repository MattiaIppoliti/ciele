import { describe, expect, it } from "vitest";
import type { Member, OrgApiKey, Role } from "@agent-hub/core";
import type { Db } from "@agent-hub/db";
import type { OperationContext } from "./operation";
import {
  leaveOrganizationOp,
  removeMemberOp,
  updateMemberRoleOp,
} from "./organization";

/**
 * Offboarding invariants from #801: an API key must not outlive the membership
 * it was delegated from (CYB-04), and an Organization must never end up with
 * no Owner (CYB-11), because promoting one is itself an Owner-tier change.
 *
 * A hand-built Db rather than the in-memory mock: the mock has no way to add a
 * second member (its `acceptInvite` is a stub), and these invariants are about
 * exactly which rows the operation touches, so a fake that records its writes
 * says more than one that hides them.
 */

const ORG = "org-1";

interface World {
  db: Db;
  members: Member[];
  keys: OrgApiKey[];
}

function world(members: Member[], keys: OrgApiKey[] = []): World {
  const state: World = {
    members: [...members],
    keys: [...keys],
    db: {} as Db,
  };
  state.db = {
    listMembers: async () => state.members,
    removeMember: async (_orgId: string, userId: string) => {
      state.members = state.members.filter((member) => member.userId !== userId);
    },
    updateMemberRole: async (_orgId: string, userId: string, role: Role) => {
      state.members = state.members.map((member) =>
        member.userId === userId ? { ...member, role } : member,
      );
    },
    listApiKeys: async () => state.keys,
    revokeApiKey: async (keyId: string) => {
      state.keys = state.keys.map((key) =>
        key.id === keyId ? { ...key, revokedAt: "2026-08-30T00:00:00.000Z" } : key,
      );
    },
  } as unknown as Db;
  return state;
}

const member = (userId: string, role: Role): Member =>
  ({
    userId,
    organizationId: ORG,
    role,
    email: `${userId}@example.edu`,
  }) as unknown as Member;

const apiKey = (id: string, createdBy: string): OrgApiKey =>
  ({
    id,
    organizationId: ORG,
    name: id,
    role: "editor" as Role,
    createdBy,
    createdAt: "2026-08-01T00:00:00.000Z",
    revokedAt: null,
    secretHint: "…abcd",
  }) as unknown as OrgApiKey;

const ctx = (state: World, over: Partial<OperationContext> = {}): OperationContext =>
  ({
    organizationId: ORG,
    userId: "owner-1",
    role: "owner" as Role,
    db: state.db,
    ...over,
  }) as OperationContext;

describe("removing a member revokes what they delegated (CYB-04)", () => {
  it("revokes the leaver's live keys and nobody else's", async () => {
    const state = world(
      [member("owner-1", "owner"), member("admin-2", "admin"), member("admin-3", "admin")],
      [apiKey("key-leaver", "admin-2"), apiKey("key-other", "admin-3")],
    );

    await removeMemberOp.run(ctx(state), { userId: "admin-2" });

    expect(state.keys.find((key) => key.id === "key-leaver")?.revokedAt).toBeTruthy();
    expect(state.keys.find((key) => key.id === "key-other")?.revokedAt).toBeNull();
    expect(state.members.map((item) => item.userId)).toEqual(["owner-1", "admin-3"]);
  });

  it("revokes on self-leave too, offboarding is offboarding", async () => {
    const state = world(
      [member("owner-1", "owner"), member("admin-2", "admin")],
      [apiKey("key-leaver", "admin-2")],
    );

    await leaveOrganizationOp.run(ctx(state, { userId: "admin-2", role: "admin" }), {});

    expect(state.keys[0]?.revokedAt).toBeTruthy();
  });

  it("revokes before the membership row goes, so a partial failure over-revokes", async () => {
    const order: string[] = [];
    const state = world([member("owner-1", "owner"), member("admin-2", "admin")], [
      apiKey("key-leaver", "admin-2"),
    ]);
    const db = state.db as unknown as Record<string, unknown>;
    const revoke = db.revokeApiKey as (id: string) => Promise<void>;
    const remove = db.removeMember as (orgId: string, userId: string) => Promise<void>;
    db.revokeApiKey = async (id: string) => {
      order.push("revoke");
      await revoke(id);
    };
    db.removeMember = async (orgId: string, userId: string) => {
      order.push("remove");
      await remove(orgId, userId);
    };

    await removeMemberOp.run(ctx(state), { userId: "admin-2" });

    expect(order).toEqual(["revoke", "remove"]);
  });

  it("does not revoke an already-revoked key again", async () => {
    const revoked = { ...apiKey("key-old", "admin-2"), revokedAt: "2026-01-01T00:00:00.000Z" };
    const state = world([member("owner-1", "owner"), member("admin-2", "admin")], [revoked]);
    const calls: string[] = [];
    (state.db as unknown as Record<string, unknown>).revokeApiKey = async (id: string) => {
      calls.push(id);
    };

    await removeMemberOp.run(ctx(state), { userId: "admin-2" });

    expect(calls).toEqual([]);
  });
});

describe("an Organization always keeps an Owner (CYB-11)", () => {
  const lastOwner = () => world([member("owner-1", "owner"), member("editor-2", "editor")]);

  it("refuses to remove the last owner", async () => {
    const state = lastOwner();
    await expect(
      removeMemberOp.run(ctx(state), { userId: "owner-1" }),
    ).rejects.toMatchObject({ code: "invalid_input" });
    expect(state.members).toHaveLength(2);
  });

  it("refuses to demote the last owner", async () => {
    const state = lastOwner();
    await expect(
      updateMemberRoleOp.run(ctx(state), { userId: "owner-1", role: "admin" }),
    ).rejects.toMatchObject({ code: "invalid_input" });
    expect(state.members[0]?.role).toBe("owner");
  });

  it("refuses to let the last owner leave", async () => {
    const state = lastOwner();
    await expect(
      leaveOrganizationOp.run(ctx(state, { userId: "owner-1" }), {}),
    ).rejects.toMatchObject({ code: "invalid_input" });
    expect(state.members).toHaveLength(2);
  });

  it("allows the handover once a successor holds the role", async () => {
    const state = world([member("owner-1", "owner"), member("admin-2", "admin")]);

    await updateMemberRoleOp.run(ctx(state), { userId: "admin-2", role: "owner" });
    await leaveOrganizationOp.run(ctx(state, { userId: "owner-1" }), {});

    expect(state.members.filter((item) => item.role === "owner")).toHaveLength(1);
    expect(state.members.map((item) => item.userId)).toEqual(["admin-2"]);
  });

  it("still allows removing a non-owner while one owner remains", async () => {
    const state = lastOwner();
    await removeMemberOp.run(ctx(state), { userId: "editor-2" });
    expect(state.members.map((item) => item.userId)).toEqual(["owner-1"]);
  });
});
