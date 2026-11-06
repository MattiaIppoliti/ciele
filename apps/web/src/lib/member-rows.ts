import type { Invite, Member, OrgRole, Role } from "@agent-hub/core";
import { memberDisplayName, memberRoleRank, roleLabel } from "@agent-hub/core";

/**
 * One line of the Members table. Accepted Members and pending Invites share
 * the table, so the row model flattens both into the same shape and the
 * Status column is what tells them apart.
 */
export interface MemberRow {
  /** Stable table key, `member:<userId>` or `invite:<id>`. */
  id: string;
  kind: "member" | "invite";
  /** userId for a member, invite id for an invite. */
  subjectId: string;
  /** Display name, falling back to the email local-part then the id. */
  name: string;
  email: string;
  /** The ladder tier of the Role, for sorting and the owner-tier rules. */
  role: Role;
  /** The Role held (`org_roles.id`), and its name as the Organization calls it. */
  roleId: string | null;
  roleName: string;
  status: "active" | "pending";
  /** Joined (member) or invited (invite). */
  since: string;
  isSelf: boolean;
  /**
   * The member's uploaded picture, when they have one. Null for an invite and
   * for anyone who never set one, where the row draws a generated avatar from
   * `subjectId` instead.
   */
  avatarUrl: string | null;
}

/**
 * Members first (owners at the top, then by name), pending invites after.
 * The table can re-sort by any column; this is only the resting order.
 */
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
      name: memberDisplayName(member),
      email: member.email,
      role: member.role,
      roleId: member.roleId ?? null,
      roleName: member.roleName ?? roleLabel(member.role),
      status: "active" as const,
      since: member.createdAt,
      isSelf: member.userId === currentUserId,
      avatarUrl: member.avatarUrl,
    }))
    .sort(
      (a, b) =>
        memberRoleRank(b.role) - memberRoleRank(a.role) || a.name.localeCompare(b.name)
    );

  const inviteRows: MemberRow[] = invites.map((invite) => ({
    id: `invite:${invite.id}`,
    kind: "invite" as const,
    subjectId: invite.id,
    name: invite.email || "Anyone with the link",
    email: invite.email,
    role: invite.role,
    roleId: invite.roleId ?? null,
    roleName: invite.roleName ?? roleLabel(invite.role),
    status: "pending" as const,
    since: invite.createdAt,
    isSelf: false,
    // Nobody has accepted it yet, so there is no profile to have a picture in.
    avatarUrl: null,
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

/** A Role as the Members, invitation and API key pickers offer it. */
export interface RoleChoice {
  id: string;
  name: string;
  /** The built-in this is, null for a custom Role. */
  key: string | null;
  tier: Role;
  capabilities: readonly string[];
  organizationLevel: boolean;
  assistantLevel: boolean;
  /** The Role a new invitation starts with. */
  memberDefault: boolean;
  /** The Role a new Assistant assignment starts with. */
  assistantDefault: boolean;
}

/**
 * The Roles the signed-in Member may give (ADR-0028): offered Organization-wide,
 * Owner only to an Owner, and only Roles whose every Capability the Member
 * holds, so the picker never offers what the server would refuse.
 */
export function assignableRoleChoices(
  roles: readonly RoleChoice[],
  caller: { canManageOwners: boolean; capabilities: readonly string[] }
): RoleChoice[] {
  const held = new Set(caller.capabilities);
  return roles.filter((role) => {
    if (!role.organizationLevel) return false;
    if (role.key === "owner") return caller.canManageOwners;
    return caller.canManageOwners || role.capabilities.every((id) => held.has(id));
  });
}

/** The picker shape of the Organization's Roles, built server-side. */
export function roleChoices(roles: readonly OrgRole[]): RoleChoice[] {
  return roles.map((role) => ({
    id: role.id,
    name: role.name,
    key: role.key,
    tier: role.tier,
    capabilities: role.capabilities,
    organizationLevel: role.organizationLevel,
    assistantLevel: role.assistantLevel,
    memberDefault: role.memberDefault,
    assistantDefault: role.assistantDefault,
  }));
}
