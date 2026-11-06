import type { OrgRole, Role } from "@agent-hub/core";
import {
  BUILTIN_ROLE_NAMES,
  builtinRoleDefaults,
  capabilitiesForLadderRole,
  isBuiltinRoleKey,
  isCapability,
  isEditedBuiltin,
  isOwnerOnlyCapability,
  withRequiredCapabilities,
} from "@agent-hub/core";
import { z } from "zod";
import { describeAuditChange } from "./audit";
import { OperationError, defineOperation, type OperationContext } from "./operation";

/**
 * Roles (#1164, ADR-0028): list, create, edit, reset and delete. The rules a
 * Member meets here, each said in words before the database refuses it:
 *
 * - **Owner is locked.** It holds every Capability and cannot be edited,
 *   reset or deleted; ownership changes through Members, never through Roles.
 * - **You cannot hand on what you do not hold.** A Role's Capabilities must be
 *   ones the caller has, when they create it, edit it, assign it to a Member,
 *   put it on an invitation or mint an API key with it. Owners are exempt.
 * - **You cannot edit the Role you hold**, so no Member widens their own
 *   reach; an Owner is exempt, and Owner is locked anyway.
 * - **A Role someone holds cannot be deleted.** Members, pending invitations
 *   and active API keys must move to another Role first; nothing silently
 *   falls back to a default.
 * - **What a Capability relies on is turned on with it**, so a saved Role is
 *   always closed over its dependencies.
 */

const capabilityList = z
  .array(z.string())
  .max(200)
  .superRefine((ids, issue) => {
    for (const id of ids) {
      if (!isCapability(id)) issue.addIssue({ code: "custom", message: `Unknown capability ${id}` });
      else if (isOwnerOnlyCapability(id)) issue.addIssue({ code: "custom", message: `${id} belongs to the Owner role alone` });
    }
  });

const roleFields = {
  name: z.string().trim().min(1, "A Role needs a name").max(80),
  description: z.string().trim().max(500),
  capabilities: capabilityList,
  organizationLevel: z.boolean(),
  assistantLevel: z.boolean(),
};

const levelsChosen = (value: { organizationLevel?: boolean; assistantLevel?: boolean }) =>
  value.organizationLevel !== false || value.assistantLevel !== false;
const LEVEL_MESSAGE = "Make the Role available at Organization level, Assistant level or both";

/** The caller's own Capabilities, as the auth seam resolved them. */
function callerCapabilities(ctx: OperationContext): ReadonlySet<string> {
  return new Set(ctx.capabilities ?? capabilitiesForLadderRole(ctx.role));
}

/** Refuses a Role that carries a Capability the caller lacks. Owners are exempt. */
export function assertMayHandOn(
  ctx: OperationContext,
  role: Pick<OrgRole, "capabilities" | "key" | "tier">,
  message = "You cannot give a Role with Capabilities you do not hold"
): void {
  if (ctx.role === "owner") return;
  if (role.key === "owner" || role.tier === "owner") throw new OperationError("invalid_input", message);
  const held = callerCapabilities(ctx);
  const missing = role.capabilities.filter((id) => !held.has(id));
  if (missing.length) {
    throw new OperationError("invalid_input", `${message}: ${missing.join(", ")}`);
  }
}

async function requireRole(ctx: OperationContext, id: string): Promise<OrgRole> {
  const role = (await ctx.db.listOrgRoles(ctx.organizationId)).find((item) => item.id === id);
  if (!role) throw new OperationError("not_found", "Role not found");
  return role;
}

/**
 * The Role an assignment names: `roleId`, or `role`, a built-in by its key,
 * the shape every client sent before custom Roles. Only a Role offered at
 * Organization level can be held Organization-wide.
 */
export async function resolveAssignableRole(
  ctx: OperationContext,
  choice: { roleId?: string; role?: Role }
): Promise<OrgRole> {
  const roles = await ctx.db.listOrgRoles(ctx.organizationId);
  const role = choice.roleId
    ? roles.find((item) => item.id === choice.roleId)
    : roles.find((item) => item.key === choice.role);
  if (!role) throw new OperationError("not_found", "Role not found");
  if (!role.organizationLevel) {
    throw new OperationError("invalid_input", `${role.name} is only available on Assistants`);
  }
  return role;
}

async function assertNameFree(ctx: OperationContext, name: string, except?: string): Promise<void> {
  const wanted = name.trim().toLowerCase();
  const taken = (await ctx.db.listOrgRoles(ctx.organizationId)).some(
    (role) => role.id !== except && role.name.trim().toLowerCase() === wanted
  );
  if (taken) throw new OperationError("conflict", `A Role called ${name.trim()} already exists`);
}

async function assertNotOwnRole(ctx: OperationContext, role: OrgRole): Promise<void> {
  if (ctx.role === "owner" || !ctx.userId) return;
  const grant = await ctx.db.getMemberGrant(ctx.organizationId, ctx.userId);
  if (grant?.roleId === role.id) {
    throw new OperationError("invalid_input", "You cannot edit the Role you hold. Ask an Owner, or someone with another Role.");
  }
}

function capabilityChanges(before: readonly string[], after: readonly string[]) {
  const was = new Set(before);
  const now = new Set(after);
  return {
    added: after.filter((id) => !was.has(id)),
    removed: before.filter((id) => !now.has(id)),
  };
}

/** A Role as the console and the API read it: with whether a built-in was edited. */
export interface RoleView extends OrgRole {
  builtIn: boolean;
  /** A built-in whose Capabilities differ from its defaults; "Reset to default" applies. */
  edited: boolean;
  /** Owner: nothing about it can be changed. */
  locked: boolean;
}

export function roleView(role: OrgRole): RoleView {
  const builtIn = role.key !== null && isBuiltinRoleKey(role.key);
  return {
    ...role,
    builtIn,
    edited: builtIn && role.key !== "owner" && isBuiltinRoleKey(role.key!) && isEditedBuiltin(role.key!, role.capabilities),
    locked: role.key === "owner",
  };
}

export const listRolesOp = defineOperation({
  name: "roles.list",
  // Every Member may see which Roles exist and what each allows.
  capability: "member",
  effect: "read",
  input: z.object({}),
  entities: () => [],
  run: async (ctx): Promise<RoleView[]> => (await ctx.db.listOrgRoles(ctx.organizationId)).map(roleView),
});

export const getRoleOp = defineOperation({
  name: "roles.get",
  capability: "member",
  effect: "read",
  input: z.object({ id: z.string().min(1) }),
  entities: () => [],
  run: async (ctx, { id }): Promise<RoleView> => roleView(await requireRole(ctx, id)),
});

export const createRoleOp = defineOperation({
  name: "roles.create",
  capability: "roles:manage",
  effect: "consequential",
  input: z.object(roleFields).refine(levelsChosen, LEVEL_MESSAGE),
  entities: () => [{ kind: "roles" as const }],
  run: async (ctx, input): Promise<RoleView> => {
    const capabilities = withRequiredCapabilities(input.capabilities);
    assertMayHandOn(ctx, { capabilities, key: null, tier: "viewer" });
    await assertNameFree(ctx, input.name);
    const role = await ctx.db.createOrgRole(ctx.organizationId, { ...input, capabilities });
    describeAuditChange({
      target: { label: role.name, detail: "Custom role" },
      changes: { Capabilities: { before: null, after: role.capabilities } },
    });
    return roleView(role);
  },
});

export const updateRoleOp = defineOperation({
  name: "roles.update",
  capability: "roles:manage",
  effect: "consequential",
  input: z.object(roleFields).partial().extend({ id: z.string().min(1) }),
  entities: () => [{ kind: "roles" as const }, { kind: "members" as const }],
  run: async (ctx, { id, ...patch }): Promise<RoleView> => {
    const current = await requireRole(ctx, id);
    if (current.key === "owner") {
      throw new OperationError("invalid_input", "The Owner role holds every capability and cannot be edited");
    }
    await assertNotOwnRole(ctx, current);
    const organizationLevel = patch.organizationLevel ?? current.organizationLevel;
    const assistantLevel = patch.assistantLevel ?? current.assistantLevel;
    if (!organizationLevel && !assistantLevel) throw new OperationError("invalid_input", LEVEL_MESSAGE);
    if (!organizationLevel && current.organizationLevel && (current.memberCount || current.inviteCount || current.apiKeyCount)) {
      throw new OperationError("conflict", `${current.name} is held Organization-wide; move its holders before limiting it to Assistants`);
    }
    if (!organizationLevel && current.memberDefault) {
      throw new OperationError("conflict", `${current.name} is the invitation default; choose another default first`);
    }
    if (!assistantLevel && current.assistantLevel && current.assistantGrantCount) {
      throw new OperationError("conflict", `${current.name} is given on ${current.assistantGrantCount} Assistant${current.assistantGrantCount === 1 ? "" : "s"}; move those first`);
    }
    if (!assistantLevel && current.assistantDefault) {
      throw new OperationError("conflict", `${current.name} is the Assistant default; choose another default first`);
    }
    if (patch.name !== undefined) await assertNameFree(ctx, patch.name, id);
    const capabilities = patch.capabilities ? withRequiredCapabilities(patch.capabilities) : undefined;
    if (capabilities) assertMayHandOn(ctx, { capabilities, key: null, tier: "viewer" });
    const role = await ctx.db.updateOrgRole(ctx.organizationId, id, {
      ...patch,
      ...(capabilities ? { capabilities } : {}),
    });
    const { added, removed } = capabilityChanges(current.capabilities, role.capabilities);
    const changes: Record<string, { before: unknown; after: unknown }> = {};
    if (current.name !== role.name) changes.Name = { before: current.name, after: role.name };
    if (current.description !== role.description) changes.Description = { before: current.description, after: role.description };
    if (added.length || removed.length) changes.Capabilities = { before: removed.length ? removed : null, after: added.length ? added : null };
    if (current.organizationLevel !== role.organizationLevel || current.assistantLevel !== role.assistantLevel) {
      changes.Availability = {
        before: { organization: current.organizationLevel, assistant: current.assistantLevel },
        after: { organization: role.organizationLevel, assistant: role.assistantLevel },
      };
    }
    describeAuditChange({ target: { label: role.name, detail: role.key ? "Built-in role" : "Custom role" }, changes });
    return roleView(role);
  },
});

export const resetRoleOp = defineOperation({
  name: "roles.reset",
  capability: "roles:manage",
  effect: "consequential",
  input: z.object({ id: z.string().min(1) }),
  entities: () => [{ kind: "roles" as const }, { kind: "members" as const }],
  run: async (ctx, { id }): Promise<RoleView> => {
    const current = await requireRole(ctx, id);
    if (!current.key || !isBuiltinRoleKey(current.key)) {
      throw new OperationError("invalid_input", "Only a built-in role has defaults to reset to");
    }
    if (current.key === "owner") {
      throw new OperationError("invalid_input", "The Owner role holds every capability and cannot be edited");
    }
    await assertNotOwnRole(ctx, current);
    // Today's defaults, the ones a new Organization starts with.
    const capabilities = builtinRoleDefaults(current.key);
    assertMayHandOn(ctx, { capabilities, key: null, tier: "viewer" });
    const role = await ctx.db.updateOrgRole(ctx.organizationId, id, {
      capabilities,
      name: BUILTIN_ROLE_NAMES[current.key],
    });
    const { added, removed } = capabilityChanges(current.capabilities, role.capabilities);
    describeAuditChange({
      target: { label: role.name, detail: "Reset to default" },
      changes: added.length || removed.length
        ? { Capabilities: { before: removed.length ? removed : null, after: added.length ? added : null } }
        : {},
    });
    return roleView(role);
  },
});

export const deleteRoleOp = defineOperation({
  name: "roles.delete",
  capability: "roles:manage",
  effect: "consequential",
  input: z.object({ id: z.string().min(1) }),
  entities: () => [{ kind: "roles" as const }],
  run: async (ctx, { id }): Promise<void> => {
    const role = await requireRole(ctx, id);
    if (role.key) throw new OperationError("invalid_input", "A built-in role cannot be deleted");
    const holders = [
      role.memberCount && `${role.memberCount} member${role.memberCount === 1 ? "" : "s"}`,
      role.inviteCount && `${role.inviteCount} pending invitation${role.inviteCount === 1 ? "" : "s"}`,
      role.apiKeyCount && `${role.apiKeyCount} active API key${role.apiKeyCount === 1 ? "" : "s"}`,
      role.assistantGrantCount && `${role.assistantGrantCount} Assistant assignment${role.assistantGrantCount === 1 ? "" : "s"}`,
    ].filter(Boolean);
    if (holders.length) {
      throw new OperationError("conflict", `${role.name} is held by ${holders.join(", ")}. Give them another role first.`);
    }
    if (role.memberDefault || role.assistantDefault) {
      throw new OperationError("conflict", `${role.name} is a default role. Choose another default first.`);
    }
    if (!(await ctx.db.deleteOrgRole(ctx.organizationId, id))) {
      throw new OperationError("conflict", "The role was not deleted");
    }
    describeAuditChange({ target: { label: role.name, detail: "Custom role" }, changes: { Capabilities: { before: role.capabilities, after: null } } });
  },
});

/**
 * Which Role a new invitation starts with, and which one a new Assistant
 * assignment starts with (#1169). Only a suggestion for the pickers: whoever
 * invites still chooses, and can only give what they hold.
 */
export const setRoleDefaultsOp = defineOperation({
  name: "roles.defaults.set",
  capability: "roles:manage",
  effect: "write",
  input: z
    .object({ memberRoleId: z.string().min(1).optional(), assistantRoleId: z.string().min(1).optional() })
    .refine((value) => Boolean(value.memberRoleId || value.assistantRoleId), "Choose a default to change"),
  entities: () => [{ kind: "roles" as const }],
  run: async (ctx, input): Promise<RoleView[]> => {
    const roles = await ctx.db.listOrgRoles(ctx.organizationId);
    const find = (id: string) => {
      const role = roles.find((item) => item.id === id);
      if (!role) throw new OperationError("not_found", "Role not found");
      return role;
    };
    const member = input.memberRoleId ? find(input.memberRoleId) : null;
    const assistant = input.assistantRoleId ? find(input.assistantRoleId) : null;
    if (member && (member.key === "owner" || !member.organizationLevel)) {
      throw new OperationError("invalid_input", "The invitation default must be offered Organization-wide, and cannot be Owner");
    }
    if (assistant && !assistant.assistantLevel) {
      throw new OperationError("invalid_input", `${assistant.name} is not available on Assistants`);
    }
    const before = { member: roles.find((role) => role.memberDefault)?.name ?? null, assistant: roles.find((role) => role.assistantDefault)?.name ?? null };
    await ctx.db.setRoleDefaults(ctx.organizationId, {
      ...(member ? { memberRoleId: member.id } : {}),
      ...(assistant ? { assistantRoleId: assistant.id } : {}),
    });
    const changes: Record<string, { before: unknown; after: unknown }> = {};
    if (member && member.name !== before.member) changes["Invitation default"] = { before: before.member, after: member.name };
    if (assistant && assistant.name !== before.assistant) changes["Assistant default"] = { before: before.assistant, after: assistant.name };
    describeAuditChange({ target: { label: "Default roles" }, changes });
    return (await ctx.db.listOrgRoles(ctx.organizationId)).map(roleView);
  },
});
