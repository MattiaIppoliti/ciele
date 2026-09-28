import type { Role } from "@agent-hub/core";
import { memberRoleRank, roleAllowsCapability } from "@agent-hub/core";

/**
 * The ladder itself lives in `@agent-hub/core` (ADR-0019: the domain and its
 * pure derivations). It moved there when a *composite* operation had to check a
 * capability from inside the operations layer, where this module is not
 * reachable. This file keeps the app-facing names and the copy that explains
 * each rung; it no longer keeps a second copy of the numbers.
 */

/** Editors and above can create/edit assistants, flows and knowledge. */
export function canEdit(role: Role | null): boolean {
  return roleAllowsCapability(role, "edit");
}

/** Admins and above can publish, delete assistants and manage members. */
export function canPublish(role: Role | null): boolean {
  return roleAllowsCapability(role, "publish");
}

export function canManageMembers(role: Role | null): boolean {
  return roleAllowsCapability(role, "manageMembers");
}

/**
 * Admins and above can read a stored turn's raw reasoning in the Inbox. The
 * Thinking panel itself: which tools ran, with what input and outcome, stays
 * visible to everyone who can open the Inbox; only the model's own
 * chain-of-thought is gated, because it quotes the Visitor's message and
 * whatever the knowledge base returned back verbatim (#557).
 */
export function canViewReasoning(role: Role | null): boolean {
  return memberRoleRank(role) >= 3;
}

/** Editors and above can view the member roster (managing it stays admin+). */
export function canViewMembers(role: Role | null): boolean {
  return memberRoleRank(role) >= 2;
}

/** Only owners can change member roles and org settings. */
export function canChangeRoles(role: Role | null): boolean {
  return roleAllowsCapability(role, "changeRoles");
}

/** Admins and above manage the Organization's API keys (#618). */
export function canManageApiKeys(role: Role | null): boolean {
  return roleAllowsCapability(role, "manageApiKeys");
}

/**
 * An API key may never carry a Role above its creator's, the key acts as a
 * delegate of the human who minted it, so the ladder caps at their rank.
 */
export function canAssignApiKeyRole(
  creator: Role | null,
  keyRole: Role
): boolean {
  return memberRoleRank(keyRole) <= memberRoleRank(creator);
}
