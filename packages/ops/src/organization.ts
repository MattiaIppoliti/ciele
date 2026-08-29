import type { Member, Organization, OrganizationPatch, Role } from "@agent-hub/core";
import {
  apiKeySecretHint,
  generateApiKeySecret,
  hashApiKeySecret,
} from "@agent-hub/core";
import { z } from "zod";
import { OperationError, defineOperation, type OperationContext } from "./operation";

const idSchema = z.string().min(1);
const roleSchema = z.enum(["owner", "admin", "editor", "viewer"]);
const roleRank: Record<Role, number> = {
  owner: 4,
  admin: 3,
  editor: 2,
  viewer: 1,
};

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

export const organizationPatchSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  logoUrl: z.string().max(2_000).nullable().optional(),
}) satisfies z.ZodType<OrganizationPatch>;

export const getOrganizationOp = defineOperation({
  name: "organization.get",
  capability: "member",
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

export const updateOrganizationOp = defineOperation({
  name: "organization.update",
  capability: "manageMembers",
  input: organizationPatchSchema,
  entities: () => [{ kind: "organization" as const }],
  run: (ctx, patch) => ctx.db.updateOrganization(ctx.organizationId, patch),
});

export const listMembersOp = defineOperation({
  name: "members.list",
  capability: "edit",
  input: z.object({}),
  entities: () => [],
  run: (ctx) => ctx.db.listMembers(ctx.organizationId),
});

export const updateMemberRoleOp = defineOperation({
  name: "members.updateRole",
  capability: "manageMembers",
  input: z.object({ userId: idSchema, role: roleSchema }),
  entities: () => [{ kind: "members" as const }],
  run: async (ctx, { userId, role }) => {
    const member = await requireMemberRow(ctx, userId);
    assertMayManageTier(ctx, member, role);
    await ctx.db.updateMemberRole(ctx.organizationId, userId, role);
    return requireMemberRow(ctx, userId);
  },
});

export const removeMemberOp = defineOperation({
  name: "members.remove",
  capability: "manageMembers",
  input: z.object({ userId: idSchema }),
  entities: () => [{ kind: "members" as const }],
  run: async (ctx, { userId }) => {
    const member = await requireMemberRow(ctx, userId);
    assertMayManageTier(ctx, member);
    await ctx.db.removeMember(ctx.organizationId, userId);
  },
});

/** Signed-in web members may leave their own Organization regardless of role. */
export const leaveOrganizationOp = defineOperation({
  name: "members.leave",
  capability: "member",
  input: z.object({}),
  entities: () => [{ kind: "members" as const }],
  run: async (ctx) => {
    if (!ctx.userId) {
      throw new OperationError("invalid_input", "A human member is required");
    }
    await requireMemberRow(ctx, ctx.userId);
    await ctx.db.removeMember(ctx.organizationId, ctx.userId);
  },
});

export const listInvitesOp = defineOperation({
  name: "invites.list",
  capability: "manageMembers",
  input: z.object({}),
  entities: () => [],
  run: (ctx) => ctx.db.listInvites(ctx.organizationId),
});

export const createInviteOp = defineOperation({
  name: "invites.create",
  capability: "manageMembers",
  input: z.object({ role: roleSchema, email: z.string().email().optional() }),
  entities: () => [{ kind: "members" as const }],
  run: (ctx, { role, email }) => {
    if (role === "owner" && ctx.role !== "owner") {
      throw new OperationError("invalid_input", "Only owners can invite another owner");
    }
    return ctx.db.createInvite(ctx.organizationId, role, email);
  },
});

export const revokeInviteOp = defineOperation({
  name: "invites.revoke",
  capability: "manageMembers",
  input: z.object({ id: idSchema }),
  entities: () => [{ kind: "members" as const }],
  run: async (ctx, { id }) => {
    const invite = (await ctx.db.listInvites(ctx.organizationId)).find(
      (item) => item.id === id
    );
    if (!invite) throw new OperationError("not_found", "Invite not found");
    await ctx.db.revokeInvite(id);
  },
});

export const listOrgApiKeysOp = defineOperation({
  name: "apiKeys.list",
  capability: "manageApiKeys",
  input: z.object({}),
  entities: () => [],
  run: (ctx) => ctx.db.listApiKeys(ctx.organizationId),
});

export const createOrgApiKeyOp = defineOperation({
  name: "apiKeys.create",
  capability: "manageApiKeys",
  input: z.object({
    name: z.string().trim().min(1).max(200),
    role: roleSchema,
  }),
  entities: () => [{ kind: "apiKeys" as const }],
  run: async (ctx, { name, role }) => {
    if (roleRank[role] > roleRank[ctx.role]) {
      throw new OperationError(
        "invalid_input",
        "An API key's role cannot exceed the calling key's role"
      );
    }
    if (!ctx.userId) {
      throw new OperationError("invalid_input", "The calling key has no human delegator");
    }
    const secret = generateApiKeySecret();
    const apiKey = await ctx.db.createApiKey(ctx.organizationId, {
      name,
      role,
      secretHash: hashApiKeySecret(secret),
      secretHint: apiKeySecretHint(secret),
      createdBy: ctx.userId,
    });
    return { apiKey, secret };
  },
});

export const revokeOrgApiKeyOp = defineOperation({
  name: "apiKeys.revoke",
  capability: "manageApiKeys",
  input: z.object({ id: idSchema }),
  entities: () => [{ kind: "apiKeys" as const }],
  run: async (ctx, { id }) => {
    const key = (await ctx.db.listApiKeys(ctx.organizationId)).find((item) => item.id === id);
    if (!key) throw new OperationError("not_found", "API key not found");
    await ctx.db.revokeApiKey(id);
  },
});
