import { deferAuditCommit, describeAuditChange } from "./audit";
import type { AuditFieldChange, Member, Organization, OrganizationPatch, Role } from "@agent-hub/core";
import {
  apiKeySecretHint,
  generateApiKeySecret,
  ROLES,
  hashApiKeySecret,
  roleLabel,
  RETENTION_BOUNDS_MESSAGE,
  RETENTION_MAX_DAYS,
  RETENTION_MIN_DAYS,
} from "@agent-hub/core";
import { z } from "zod";
import { OperationError, defineOperation, type OperationContext } from "./operation";
import { assertMayHandOn, resolveAssignableRole } from "./roles";

const idSchema = z.string().min(1);
const roleSchema = z.enum(ROLES);

/**
 * Which Role to give (ADR-0028): `roleId`, any Role of the Organization,
 * custom ones included; or `role`, a built-in by name, which is what every
 * client before custom Roles sends and keeps working.
 */
const roleChoice = {
  roleId: idSchema.optional(),
  role: roleSchema.optional(),
};
const requireRoleChoice = (value: { roleId?: string; role?: Role }) => Boolean(value.roleId || value.role);
const ROLE_CHOICE_MESSAGE = "Choose a Role: roleId, or role for a built-in";

async function requireMemberRow(
  ctx: OperationContext,
  userId: string
): Promise<Member> {
  const member = (await ctx.db.listMembers(ctx.organizationId)).find(
    (item) => item.userId === userId
  );
  if (!member) throw new OperationError("not_found", "Member not found");
  return member;
}

function assertMayManageTier(ctx: OperationContext, member: Member, nextRole?: Role) {
  if (ctx.role === "owner") return;
  if (member.role === "owner" || nextRole === "owner") {
    throw new OperationError("invalid_input", "Only owners can change an owner");
  }
}

/**
 * An Organization with no Owner cannot appoint one: Owner-tier changes need an
 * Owner, so the last one leaving locks the Organization out of its own member
 * management for good (#801, CYB-11). Refusing is the recoverable answer;
 * hand the role over first.
 */
async function assertNotLastOwner(
  ctx: OperationContext,
  member: Member,
  nextRole?: Role
): Promise<void> {
  if (member.role !== "owner" || nextRole === "owner") return;
  const owners = (await ctx.db.listMembers(ctx.organizationId)).filter(
    (item) => item.role === "owner"
  );
  if (owners.length > 1) return;
  throw new OperationError(
    "invalid_input",
    "This is the last owner. Promote another member to owner first."
  );
}

/**
 * An API key is a delegation of the Member who minted it, so it must not
 * outlive their membership (#801, CYB-04). Revoked *before* the membership row
 * goes, because the failure to prefer is an over-revoked key, never a live key
 * belonging to someone who has left.
 */
async function revokeKeysDelegatedBy(
  ctx: OperationContext,
  userId: string
): Promise<void> {
  const keys = await ctx.db.listApiKeys(ctx.organizationId);
  for (const key of keys) {
    if (key.createdBy === userId && !key.revokedAt) await ctx.db.revokeApiKey(key.id);
  }
}

/**
 * Zod strips what a schema does not declare, so a field missing from here is a
 * field the console appears to save and does not. `traceRetentionDays` was
 * missing: the Settings control wrote it, `runOperation` parsed it away, and
 * the sweep never saw a policy (found while adding its transcript twin,
 * #801/CYB-12).
 */
/**
 * One month to five years: the Data retention tab's bounds, and the check
 * constraints of 20261104130000_data_retention. Conversations take them too,
 * on writes only, so a window saved before the tab existed still reads back.
 */
const retentionWindow = z
  .number()
  .int()
  .min(RETENTION_MIN_DAYS, RETENTION_BOUNDS_MESSAGE)
  .max(RETENTION_MAX_DAYS, RETENTION_BOUNDS_MESSAGE);

export const organizationPatchSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  logoUrl: z.string().max(2_000).nullable().optional(),
  traceRetentionDays: z.number().int().positive().nullable().optional(),
  transcriptRetentionDays: retentionWindow.nullable().optional(),
  messageRetentionDays: retentionWindow.nullable().optional(),
  improvementRetentionDays: retentionWindow.nullable().optional(),
  // Always enforced: there is no keep-forever setting for the audit log.
  auditRetentionDays: retentionWindow.optional(),
}) satisfies z.ZodType<OrganizationPatch>;

export const getOrganizationOp = defineOperation({
  name: "organization.get",
  capability: "member",
  effect: "read",
  input: z.object({}),
  entities: () => [],
  run: async (ctx): Promise<Organization> => {
    const organization = (await ctx.db.listOrganizations()).find(
      (item) => item.id === ctx.organizationId
    );
    if (!organization) throw new OperationError("not_found", "Organization not found");
    return organization;
  },
});

/** The retention windows as the audit log shows them, one key per data type. */
function retentionPolicy(organization: Organization) {
  return {
    conversations: organization.transcriptRetentionDays ?? null,
    messages: organization.messageRetentionDays ?? null,
    improvements: organization.improvementRetentionDays ?? null,
    auditRecords: organization.auditRetentionDays ?? null,
    reasoningTraces: organization.traceRetentionDays ?? null,
  };
}

export const updateOrganizationOp = defineOperation({
  name: "organization.update",
  capability: "organization:edit",
  effect: "consequential",
  input: organizationPatchSchema,
  entities: () => [{ kind: "organization" as const }],
  run: async (ctx, patch) => {
    const before = (await ctx.db.listOrganizations()).find((item) => item.id === ctx.organizationId);
    const after = await ctx.db.updateOrganization(ctx.organizationId, patch);
    if (before) {
      const changes: Record<string, AuditFieldChange> = {};
      if (before.name !== after.name) changes.Name = { before: before.name, after: after.name };
      if ((before.logoUrl ?? null) !== (after.logoUrl ?? null)) {
        changes.Logo = { before: before.logoUrl ?? null, after: after.logoUrl ?? null };
      }
      const policyBefore = retentionPolicy(before);
      const policyAfter = retentionPolicy(after);
      if (JSON.stringify(policyBefore) !== JSON.stringify(policyAfter)) {
        changes["Retention policy"] = { before: policyBefore, after: policyAfter };
      }
      describeAuditChange({ target: { label: after.name }, changes });
    }
    return after;
  },
});

const positiveLimit = (message: string) =>
  z.number({ error: message }).positive(message).nullable();

/**
 * The Organization's daily AI budget (Settings → AI). Admin+, the same gate
 * as provider keys, since the budget decides whether their spend is allowed.
 * A limit is positive or absent; tokens are whole and euros are cents.
 */
export const setOrgBudgetOp = defineOperation({
  name: "organization.budget.set",
  capability: "organization:edit",
  effect: "consequential",
  input: z.object({
    dailyTokenLimit: positiveLimit("The daily token limit must be a positive number."),
    dailyEuroLimit: positiveLimit("The daily euro limit must be a positive number."),
    enforcement: z.enum(["notify", "block"]),
  }),
  entities: () => [{ kind: "aiSettings" as const }],
  run: (ctx, input) =>
    ctx.db.setOrgBudget(ctx.organizationId, {
      dailyTokenLimit:
        input.dailyTokenLimit === null ? null : Math.floor(input.dailyTokenLimit),
      dailyEuroLimit:
        input.dailyEuroLimit === null ? null : Math.round(input.dailyEuroLimit * 100) / 100,
      enforcement: input.enforcement,
    }),
});

export const listMembersOp = defineOperation({
  name: "members.list",
  capability: "members:view",
  effect: "read",
  input: z.object({}),
  entities: () => [],
  run: (ctx) => ctx.db.listMembers(ctx.organizationId),
});

export const updateMemberRoleOp = defineOperation({
  name: "members.updateRole",
  capability: "members:manage",
  effect: "consequential",
  input: z.object({ userId: idSchema, ...roleChoice }).refine(requireRoleChoice, ROLE_CHOICE_MESSAGE),
  entities: () => [{ kind: "members" as const }],
  run: async (ctx, { userId, ...choice }) => {
    const member = await requireMemberRow(ctx, userId);
    const role = await resolveAssignableRole(ctx, choice);
    assertMayManageTier(ctx, member, role.tier);
    assertMayHandOn(ctx, role);
    await assertNotLastOwner(ctx, member, role.tier);
    await ctx.db.updateMemberRole(ctx.organizationId, userId, role.id);
    const before = member.roleName ?? roleLabel(member.role);
    describeAuditChange({
      target: { label: member.email, detail: `${role.name} role` },
      changes: { Role: { before, after: role.name } },
    });
    return requireMemberRow(ctx, userId);
  },
});

export const removeMemberOp = defineOperation({
  name: "members.remove",
  capability: "members:manage",
  effect: "consequential",
  input: z.object({ userId: idSchema }),
  entities: () => [{ kind: "members" as const }, { kind: "apiKeys" as const }],
  run: async (ctx, { userId }) => {
    const member = await requireMemberRow(ctx, userId);
    assertMayManageTier(ctx, member);
    await assertNotLastOwner(ctx, member);
    await revokeKeysDelegatedBy(ctx, userId);
    await ctx.db.removeMember(ctx.organizationId, userId);
    describeAuditChange({
      target: { label: member.email, detail: `${member.roleName ?? roleLabel(member.role)} role` },
      changes: { Role: { before: member.roleName ?? roleLabel(member.role), after: null } },
    });
  },
});

/**
 * Signed-in web members may leave their own Organization, but not the last
 * Owner: leaving is offboarding, so it revokes what the leaver delegated too.
 */
export const leaveOrganizationOp = defineOperation({
  name: "members.leave",
  capability: "member",
  effect: "consequential",
  input: z.object({}),
  entities: () => [{ kind: "members" as const }, { kind: "apiKeys" as const }],
  run: async (ctx) => {
    if (!ctx.userId) {
      throw new OperationError("invalid_input", "A human member is required");
    }
    const member = await requireMemberRow(ctx, ctx.userId);
    await assertNotLastOwner(ctx, member);
    await revokeKeysDelegatedBy(ctx, ctx.userId);
    describeAuditChange({ target: { label: member.email, detail: `${member.roleName ?? roleLabel(member.role)} role` } });
    deferAuditCommit({ member, run: entry => ctx.db.leaveOrganization(ctx.organizationId, ctx.userId, entry) });
  },
});

export const listInvitesOp = defineOperation({
  name: "invites.list",
  capability: "members:manage",
  effect: "read",
  input: z.object({}),
  entities: () => [],
  run: (ctx) => ctx.db.listInvites(ctx.organizationId),
});

export const createInviteOp = defineOperation({
  name: "invites.create",
  capability: "members:manage",
  effect: "consequential",
  input: z.object({ ...roleChoice, email: z.string().email().optional() }).refine(requireRoleChoice, ROLE_CHOICE_MESSAGE),
  entities: () => [{ kind: "members" as const }],
  run: async (ctx, { email, ...choice }) => {
    const role = await resolveAssignableRole(ctx, choice);
    if (role.tier === "owner" && ctx.role !== "owner") {
      throw new OperationError("invalid_input", "Only owners can invite another owner");
    }
    assertMayHandOn(ctx, role);
    describeAuditChange({
      // An invitation link without an address is still a grant of a Role.
      target: { label: email ?? "Invitation link", detail: `${role.name} role` },
    });
    return ctx.db.createInvite(ctx.organizationId, role.id, email);
  },
});

export const revokeInviteOp = defineOperation({
  name: "invites.revoke",
  capability: "members:manage",
  effect: "consequential",
  input: z.object({ id: idSchema }),
  entities: () => [{ kind: "members" as const }],
  run: async (ctx, { id }) => {
    const invite = (await ctx.db.listInvites(ctx.organizationId)).find(
      (item) => item.id === id
    );
    if (!invite) throw new OperationError("not_found", "Invite not found");
    await ctx.db.revokeInvite(id);
    describeAuditChange({
      target: { label: invite.email ?? "Invitation link", detail: `${invite.roleName ?? roleLabel(invite.role)} role` },
    });
  },
});

export const listOrgApiKeysOp = defineOperation({
  name: "apiKeys.list",
  capability: "apiKeys:manage",
  effect: "read",
  input: z.object({}),
  entities: () => [],
  run: (ctx) => ctx.db.listApiKeys(ctx.organizationId),
});

export const createOrgApiKeyOp = defineOperation({
  name: "apiKeys.create",
  capability: "apiKeys:manage",
  effect: "consequential",
  input: z.object({
    name: z.string().trim().min(1).max(200),
    ...roleChoice,
  }).refine(requireRoleChoice, ROLE_CHOICE_MESSAGE),
  entities: () => [{ kind: "apiKeys" as const }],
  run: async (ctx, { name, ...choice }) => {
    const role = await resolveAssignableRole(ctx, choice);
    // A key delegates at most what its creator holds: every Capability of its
    // Role must be one the caller has (the rank cap and the Support Agent
    // rule this replaces were both special cases of it).
    assertMayHandOn(ctx, role, "An API key's role cannot exceed the calling key's role");
    if (!ctx.userId) {
      throw new OperationError("invalid_input", "The calling key has no human delegator");
    }
    const secret = generateApiKeySecret();
    const apiKey = await ctx.db.createApiKey(ctx.organizationId, {
      name,
      roleId: role.id,
      role: role.tier,
      secretHash: hashApiKeySecret(secret),
      secretHint: apiKeySecretHint(secret),
      createdBy: ctx.userId,
    });
    // The name and the Role, never the secret or its hint.
    describeAuditChange({ target: { label: name, detail: `${role.name} role` } });
    return { apiKey, secret };
  },
});

export const deleteOrgApiKeyOp = defineOperation({
  name: "apiKeys.delete",
  capability: "apiKeys:manage",
  effect: "consequential",
  input: z.object({ id: idSchema }),
  entities: () => [{ kind: "apiKeys" as const }],
  run: async (ctx, { id }) => {
    const key = (await ctx.db.listApiKeys(ctx.organizationId)).find((item) => item.id === id);
    if (!key) throw new OperationError("not_found", "API key not found");
    // Revoke first: a key must stop authenticating before its row goes.
    if (!key.revokedAt) {
      throw new OperationError("conflict", "Revoke the key before deleting it");
    }
    // The database has the last word (its delete policy is on revoked rows
    // for admins only); a delete it refused is not reported as done.
    if (!(await ctx.db.deleteRevokedApiKey(id))) {
      throw new OperationError("conflict", "The API key was not deleted");
    }
    describeAuditChange({ target: { label: key.name, detail: `${key.roleName ?? roleLabel(key.role)} role` } });
  },
});

export const revokeOrgApiKeyOp = defineOperation({
  name: "apiKeys.revoke",
  capability: "apiKeys:manage",
  effect: "consequential",
  input: z.object({ id: idSchema }),
  entities: () => [{ kind: "apiKeys" as const }],
  run: async (ctx, { id }) => {
    const key = (await ctx.db.listApiKeys(ctx.organizationId)).find((item) => item.id === id);
    if (!key) throw new OperationError("not_found", "API key not found");
    await ctx.db.revokeApiKey(id);
    describeAuditChange({ target: { label: key.name, detail: `${key.roleName ?? roleLabel(key.role)} role` } });
  },
});
