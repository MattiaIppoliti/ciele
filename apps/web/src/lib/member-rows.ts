import type { Invite, Member, Role } from "@agent-hub/core";

/**
 * One line of the Members table. Accepted Members and pending Invites share
 * the table, so the row model flattens both into the same shape and the
 * Status column is what tells them apart.
 */
export interface MemberRow {
  /** Stable table key — `member:<userId>` or `invite:<id>`. */
  id: string;
  kind: "member" | "invite";
  /** userId for a member, invite id for an invite. */
  subjectId: string;
  /** Display name, falling back to the email local-part then the id. */
  name: string;
  email: string;
  role: Role;
  status: "active" | "pending";
  /** Joined (member) or invited (invite). */
  since: string;
  isSelf: boolean;
}

function displayName(member: Member): string {
  const full = [member.firstName, member.lastName].filter(Boolean).join(" ");
  if (full) return full;
  if (member.username) return member.username;
  if (member.email) return member.email.split("@")[0];
  return member.userId;
}

/**
 * Members first (owners at the top, then by name), pending invites after.
 * The table can re-sort by any column; this is only the resting order.
 */
const ROLE_RANK: Record<Role, number> = {
  owner: 4,
  admin: 3,
  editor: 2,
  viewer: 1,
};

export function buildMemberRows(
  members: Member[],
  invites: Invite[],
  currentUserId: string
): MemberRow[] {
  const memberRows: MemberRow[] = members
    .map((member) => ({
      id: `member:${member.userId}`,
      kind: "member" as const,
      subjectId: member.userId,
      name: displayName(member),
      email: member.email,
      role: member.role,
      status: "active" as const,
      since: member.createdAt,
      isSelf: member.userId === currentUserId,
    }))
    .sort(
      (a, b) =>
        ROLE_RANK[b.role] - ROLE_RANK[a.role] || a.name.localeCompare(b.name)
    );

  const inviteRows: MemberRow[] = invites.map((invite) => ({
    id: `invite:${invite.id}`,
    kind: "invite" as const,
    subjectId: invite.id,
    name: invite.email || "Anyone with the link",
    email: invite.email,
    role: invite.role,
    status: "pending" as const,
    since: invite.createdAt,
    isSelf: false,
  }));

  return [...memberRows, ...inviteRows];
}

/**
 * Whether the signed-in Member may edit `row`'s role or remove them.
 * Mirrors the RLS policy in 20260728120000: admins manage everyone below the
 * owner tier, owners manage everyone, and nobody edits or removes themselves
 * from this table (self-leave is a separate flow).
 */
export function canManageRow(
  row: MemberRow,
  opts: { canManageMembers: boolean; canManageOwners: boolean }
): boolean {
  if (!opts.canManageMembers) return false;
  if (row.isSelf) return false;
  if (row.role === "owner" && !opts.canManageOwners) return false;
  return true;
}

/** Roles the signed-in Member is allowed to assign. */
export function assignableRoles(canManageOwners: boolean): Role[] {
  const roles: Role[] = ["admin", "editor", "viewer"];
  return canManageOwners ? ["owner", ...roles] : roles;
}
