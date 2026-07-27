import type { Role } from "@agent-hub/core";

const RANK: Record<Role, number> = { owner: 4, admin: 3, editor: 2, viewer: 1 };

export function roleRank(role: Role | null): number {
  return role ? RANK[role] : 0;
}

/** Editors and above can create/edit assistants, flows and knowledge. */
export function canEdit(role: Role | null): boolean {
  return roleRank(role) >= 2;
}

/** Admins and above can publish, delete assistants and manage members. */
export function canPublish(role: Role | null): boolean {
  return roleRank(role) >= 3;
}

export function canManageMembers(role: Role | null): boolean {
  return roleRank(role) >= 3;
}

/** Editors and above can view the member roster (managing it stays admin+). */
export function canViewMembers(role: Role | null): boolean {
  return roleRank(role) >= 2;
}

/** Only owners can change member roles and org settings. */
export function canChangeRoles(role: Role | null): boolean {
  return roleRank(role) >= 4;
}
