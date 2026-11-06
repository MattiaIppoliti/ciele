import type { AssistantAccessRole, MemberAssistantScope, Role } from "./types";
import { memberRoleRank } from "./teammate-grants";

const OVERRIDE_RANK: Record<AssistantAccessRole, number> = { denied: 0, viewer: 1, editor: 2, admin: 3 };

/**
 * A Member's rank on one Assistant, the TypeScript twin of
 * `private.has_assistant_role` (20261104132000) for the reads that run on the
 * service role. An Owner keeps their rank; an override row replaces the org
 * Role in either direction; with no row, a Member limited to selected
 * Assistants has none, and anyone else has their org Role. 0 means no access.
 */
export function assistantAccessRank(input: {
  orgRole: Role | null;
  override: AssistantAccessRole | null | undefined;
  scope: MemberAssistantScope | undefined;
}): number {
  if (!input.orgRole) return 0;
  if (input.orgRole === "owner") return memberRoleRank("owner");
  if (input.override) return OVERRIDE_RANK[input.override];
  if (input.scope === "selected") return 0;
  return memberRoleRank(input.orgRole);
}
