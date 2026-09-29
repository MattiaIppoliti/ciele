import { z } from "zod";
import type { Memory } from "@agent-hub/core";
import { OperationError, defineOperation, type OperationContext } from "./operation";

const idSchema = z.object({ id: z.string().min(1) });

const IDENTITY_CLAIM_PATTERN = /^[a-zA-Z0-9_.:-]{1,64}$/;

export const getSsoIdentityOp = defineOperation({
  name: "sso.identity.get",
  capability: "manageMembers",
  input: z.object({}),
  entities: () => [],
  run: async (ctx) => {
    const connection = await ctx.db.getSsoConnection(ctx.organizationId);
    return connection
      ? {
          connected: true as const,
          provider: connection.provider,
          identityClaim: connection.config.identityClaim ?? null,
          validationStatus: connection.validationStatus,
        }
      : { connected: false as const };
  },
});

export const setSsoIdentityOp = defineOperation({
  name: "sso.identity.set",
  capability: "manageMembers",
  input: z.object({ identityClaim: z.string().nullable() }),
  entities: () => [{ kind: "aiSettings" as const }],
  run: async (ctx, { identityClaim }) => {
    const connection = await ctx.db.getSsoConnection(ctx.organizationId);
    if (!connection) throw new OperationError("not_found", "SSO connection not found");
    const claim = identityClaim?.trim() || null;
    if (claim && !IDENTITY_CLAIM_PATTERN.test(claim)) {
      throw new OperationError("invalid_input", "Identity claim name is invalid");
    }
    const { identityClaim: _identityClaim, ...baseConfig } = connection.config;
    await ctx.db.setSsoConnection(ctx.organizationId, {
      provider: connection.provider,
      config: claim ? { ...baseConfig, identityClaim: claim } : baseConfig,
      // encryptedSecret omitted: the stored secret is kept as it is.
    });
    return { identityClaim: claim };
  },
});

export const validateSsoIdentityOp = defineOperation({
  name: "sso.identity.validate",
  capability: "manageMembers",
  input: z.object({}),
  entities: () => [{ kind: "aiSettings" as const }],
  run: async (ctx) => {
    const connection = await ctx.db.getSsoConnection(ctx.organizationId);
    if (!connection) throw new OperationError("not_found", "SSO connection not found");
    if (!ctx.ports?.validateSsoConnection) {
      throw new OperationError("invalid_input", "SSO validation is unavailable");
    }
    const result = await ctx.ports.validateSsoConnection(connection);
    await ctx.db.setSsoConnectionValidation(
      ctx.organizationId,
      result.ok ? "valid" : "invalid"
    );
    return result;
  },
});

export const getMemorySettingsOp = defineOperation({
  name: "memories.settings.get", capability: "member", input: z.object({}), entities: () => [],
  run: async (ctx) => ({ enabled: await ctx.db.getMemoryEnabled(ctx.organizationId) }),
});
export const setMemorySettingsOp = defineOperation({
  name: "memories.settings.set", capability: "manageMembers", input: z.object({ enabled: z.boolean() }),
  entities: () => [{ kind: "aiSettings" as const }],
  run: async (ctx, { enabled }) => { await ctx.db.setMemoryEnabled(ctx.organizationId, enabled); return { enabled }; },
});
export const listMemorySubjectsPageOp = defineOperation({
  name: "memories.subjects.listPage", capability: "member",
  input: z.object({
    limit: z.number().int().min(1).max(100),
    cursor: z.string().min(1).nullable().optional(),
  }),
  entities: () => [],
  run: (ctx, input) => ctx.db.listMemorySubjectsPage(ctx.organizationId, input),
});
export const listSubjectMemoriesOp = defineOperation({
  name: "memories.subject.list", capability: "member", input: z.object({ subjectId: z.string().min(1) }), entities: () => [],
  run: (ctx, { subjectId }) =>
    ctx.db.listMemories({ organizationId: ctx.organizationId, subjectId }),
});
async function requireMemory(ctx: OperationContext, id: string): Promise<Memory> {
  const memory = await ctx.db.getMemory(id);
  if (memory?.organizationId === ctx.organizationId) return memory;
  throw new OperationError("not_found", "Memory not found");
}
export const deleteMemoryOp = defineOperation({
  name: "memories.delete", capability: "edit", input: idSchema, entities: () => [{ kind: "aiSettings" as const }],
  run: async (ctx, { id }) => { await requireMemory(ctx, id); await ctx.db.deleteMemory(id); },
});
export const wipeSubjectMemoriesOp = defineOperation({
  name: "memories.subject.wipe", capability: "edit", input: z.object({ subjectId: z.string().min(1) }), entities: () => [{ kind: "aiSettings" as const }],
  run: async (ctx, { subjectId }) =>
    ctx.db.deleteSubjectMemories({ organizationId: ctx.organizationId, subjectId }),
});
