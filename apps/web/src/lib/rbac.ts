import type { CapabilityRequirement, Role } from "@agent-hub/core";
import { capabilitiesAllow, memberRoleRank, roleLabel } from "@agent-hub/core";

/**
 * What the console shows a Member (ADR-0028): every control is gated on the
 * Capability the operation behind it requires, the same check the server
 * makes, so a narrowed Role does not see a button it would be refused on.
 *
 * Pages pass {@link Access} from `requirePageMember` (or, on an Assistant's
 * pages, `requireAssistantPageAccess`, which applies the Member's Role on that
 * Assistant). The ladder helpers below it are what is left of the tier model
 * and gate only navigation into Settings, which follows the tier because the
 * Settings rail is the Organization scope.
 */

/** How a Role reads in the console; the one copy lives in `@agent-hub/core`. */
export { roleLabel };

export interface Access {
  role: Role | null;
  capabilities: readonly string[];
}

/** Whether the Member may do what an operation requiring `capability` does. */
export function can(access: Access | null | undefined, capability: CapabilityRequirement): boolean {
  return Boolean(access) && capabilitiesAllow(access!.capabilities, capability);
}

/**
 * Whether the Organization-scoped Settings tabs are offered at all. A tier on
 * purpose: those tabs are the Organization's administration, and each page
 * still checks its own Capability.
 */
export function canManageMembers(role: Role | null): boolean {
  return memberRoleRank(role) >= 3;
}
