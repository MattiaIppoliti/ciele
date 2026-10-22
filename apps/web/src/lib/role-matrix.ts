import type { Role } from "@agent-hub/core";
import { roleAllowsCapability } from "@agent-hub/core";

/**
 * What each Role may do, as Settings → Members shows it (#1074).
 *
 * The rows name capabilities and the cells are asked of `roleAllowsCapability`,
 * the same predicate every operation is gated on, so the matrix cannot claim a
 * permission the server would refuse. Only the words are written here.
 */
export const MATRIX_ROLES: readonly Role[] = ["owner", "admin", "editor", "viewer"];

export interface RoleMatrixRow {
  capability: string;
  label: string;
  detail: string;
  allowed: Record<Role, boolean>;
}

const ROWS: ReadonlyArray<Omit<RoleMatrixRow, "allowed">> = [
  {
    capability: "member",
    label: "Read and take part",
    detail: "See Assistants, conversations, Projects and Tasks. Comment, react and chat with Teammates.",
  },
  {
    capability: "edit",
    label: "Build",
    detail: "Create and change Assistants, knowledge, Flows, Projects and Tasks.",
  },
  {
    capability: "publish",
    label: "Publish",
    detail: "Publish an Assistant and delete one.",
  },
  {
    capability: "manageMembers",
    label: "Manage members",
    detail: "Invite people, change roles up to Admin, and remove members.",
  },
  {
    capability: "manageApiKeys",
    label: "Manage API keys",
    detail: "Create and revoke the Organization's API keys.",
  },
  {
    capability: "changeRoles",
    label: "Manage owners",
    detail: "Make someone an Owner, or remove an Owner.",
  },
];

export function roleMatrix(): RoleMatrixRow[] {
  return ROWS.map((row) => ({
    ...row,
    allowed: Object.fromEntries(
      MATRIX_ROLES.map((role) => [role, roleAllowsCapability(role, row.capability)])
    ) as Record<Role, boolean>,
  }));
}
