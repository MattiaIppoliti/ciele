import { z } from "zod";
import { defineOperation } from "./operation";

/** An operation name as the action filter takes it: `members.updateRole`. */
const operationName = z.string().regex(/^[a-zA-Z][a-zA-Z0-9]*(\.[a-zA-Z][a-zA-Z0-9]*)+$/, "An action looks like members.updateRole");

export const auditLogFilterInput = z.object({
  /** A Member's user id, or `system` for entries no person made. */
  memberId: z.string().optional(),
  domain: z.string().regex(/^[a-zA-Z0-9_-]+$/).optional(),
  operations: z.array(operationName).max(50).optional(),
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
  order: z.enum(["newest", "oldest"]).optional(),
  before: z.iso.datetime().optional(),
  beforeId: z.uuid().optional(),
  after: z.iso.datetime().optional(),
  afterId: z.uuid().optional(),
  limit: z.number().int().min(1).max(1000).optional(),
});
export const listAuditLogOp = defineOperation({
  name: "audit.list", capability: "audit:view", effect: "read", input: auditLogFilterInput,
  entities: () => [], run: (ctx, input) => ctx.db.listAuditEntries(ctx.organizationId, input),
});
export const exportAuditLogOp = defineOperation({
  name: "audit.export", capability: "audit:view", effect: "write", input: auditLogFilterInput.omit({ before: true, beforeId: true, after: true, afterId: true, limit: true }),
  entities: () => [], run: (ctx, input) => ctx.db.createExportJob(ctx.organizationId, { kind: "audit_log", format: "csv", params: { ...input, to: input.to ?? new Date().toISOString() } }),
});
