import { describe, expect, it } from "vitest";
import type { Invite, Member, Role } from "@agent-hub/core";
import {
  assignableRoles,
  buildMemberRows,
  canManageRow,
  type MemberRow,
} from "./member-rows";

function member(overrides: Partial<Member> & { userId: string }): Member {
  return {
    email: `${overrides.userId}@example.edu`,
    role: "viewer",
    username: null,
    firstName: null,
    lastName: null,
    avatarUrl: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function invite(overrides: Partial<Invite> & { id: string }): Invite {
  return {
    organizationId: "org",
    email: "invited@example.edu",
    role: "editor",
    token: "tok",
    createdAt: "2026-02-01T00:00:00.000Z",
    ...overrides,
  };
}

function row(overrides: Partial<MemberRow> = {}): MemberRow {
  return {
    id: "member:u1",
    kind: "member",
    subjectId: "u1",
    name: "Ada",
    email: "ada@example.edu",
    role: "editor",
    status: "active",
    since: "2026-01-01T00:00:00.000Z",
    isSelf: false,
    ...overrides,
  };
}

describe("buildMemberRows", () => {
  it("prefers the profile name, then username, then the email local-part", () => {
    const rows = buildMemberRows(
      [
        member({ userId: "u1", firstName: "Ada", lastName: "Lovelace" }),
        member({ userId: "u2", username: "grace" }),
        member({ userId: "u3", email: "alan@example.edu" }),
      ],
      [],
      "u1"
    );
    expect(rows.map((r) => r.name).sort()).toEqual([
      "Ada Lovelace",
      "alan",
      "grace",
    ]);
  });

  it("falls back to the user id when there is no profile and no email", () => {
    const [only] = buildMemberRows([member({ userId: "u9", email: "" })], [], "x");
    expect(only.name).toBe("u9");
  });

  it("orders members owner-first then by name, invites last", () => {
    const rows = buildMemberRows(
      [
        member({ userId: "u1", firstName: "Zoe", role: "viewer" }),
        member({ userId: "u2", firstName: "Ada", role: "owner" }),
        member({ userId: "u3", firstName: "Bob", role: "viewer" }),
      ],
      [invite({ id: "i1" })],
      "u1"
    );
    expect(rows.map((r) => r.name)).toEqual([
      "Ada",
      "Bob",
      "Zoe",
      "invited@example.edu",
    ]);
    expect(rows.at(-1)).toMatchObject({ kind: "invite", status: "pending" });
  });

  it("marks the signed-in member and keys rows by kind", () => {
    const rows = buildMemberRows(
      [member({ userId: "u1" }), member({ userId: "u2" })],
      [invite({ id: "i1" })],
      "u2"
    );
    expect(rows.filter((r) => r.isSelf).map((r) => r.subjectId)).toEqual(["u2"]);
    expect(rows.map((r) => r.id)).toContain("invite:i1");
  });

  it("labels a link-only invite instead of showing a blank name", () => {
    const [only] = buildMemberRows([], [invite({ id: "i1", email: "" })], "u1");
    expect(only.name).toBe("Anyone with the link");
    expect(only.email).toBe("");
  });
});

describe("canManageRow", () => {
  const owner = { canManageMembers: true, canManageOwners: true };
  const admin = { canManageMembers: true, canManageOwners: false };
  const editor = { canManageMembers: false, canManageOwners: false };

  it("lets an admin manage everyone below the owner tier", () => {
    expect(canManageRow(row({ role: "admin" }), admin)).toBe(true);
    expect(canManageRow(row({ role: "owner" }), admin)).toBe(false);
  });

  it("lets an owner manage owners too", () => {
    expect(canManageRow(row({ role: "owner" }), owner)).toBe(true);
  });

  it("never lets anyone manage their own row", () => {
    expect(canManageRow(row({ isSelf: true }), owner)).toBe(false);
  });

  it("gives a viewer/editor no row actions at all", () => {
    expect(canManageRow(row(), editor)).toBe(false);
  });
});

describe("assignableRoles", () => {
  it("withholds owner from an admin", () => {
    expect(assignableRoles(false)).not.toContain<Role>("owner");
    expect(assignableRoles(true)[0]).toBe("owner");
  });
});
