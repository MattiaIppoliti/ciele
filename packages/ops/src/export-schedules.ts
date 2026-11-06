import { requireAssistant } from "./assistants";
import { z } from "zod";
import { defineOperation, OperationError, type OperationContext } from "./operation";
const cadence = z.discriminatedUnion("kind", [z.object({ kind: z.literal("weekly"), weekday: z.number().int().min(0).max(6) }), z.object({ kind: z.literal("monthly"), day: z.number().int().min(1).max(31) })]);
const definitionFields = z.object({
  name: z.string().trim().min(1).max(120), kind: z.enum(["insights_overview", "insights_datapoints", "insights_languages"]), format: z.enum(["csv", "json", "xlsx"]),
  filters: z.record(z.string(), z.string()), cadence, hour: z.number().int().min(0).max(23),
  recipientMemberIds: z.array(z.string().min(1)).min(1).max(100).transform(ids => [...new Set(ids)]), enabled: z.boolean(),
});
export const exportScheduleDefinition = definitionFields.extend({ filters: definitionFields.shape.filters.default({}), enabled: definitionFields.shape.enabled.default(true) });
export const exportSchedulePatch = definitionFields.partial();
function schemaLag(error: unknown) { return Boolean(error && typeof error === "object" && "code" in error && ["42P01", "42703", "PGRST204", "PGRST205"].includes(String(error.code))); }
async function validateRecipients(ctx: OperationContext, ids: string[] | undefined) {
  if (!ids) return;
  const members = new Set((await ctx.db.listMembers(ctx.organizationId)).map(member => member.userId));
  if (ids.some(id => !members.has(id))) throw new OperationError("invalid_input", "Recipients must be current Members of this Organization");
}
async function requireSchedule(ctx: OperationContext, id: string) {
  try {
    const row = await ctx.db.table("exportSchedules").get(id);
    if (!row || row.organizationId !== ctx.organizationId) throw new OperationError("not_found", "Export schedule not found");
    return row;
  } catch (error) { if (schemaLag(error)) throw new OperationError("invalid_input", "Apply the latest migration to use export schedules"); throw error; }
}
const entities = () => [{ kind: "exportSchedules" as const }];
export const listExportSchedulesOp = defineOperation({ name: "exports.schedules.list", capability: "insights:view", effect: "read", input: z.object({}), entities: () => [], run: async ctx => {
  try { return { available: true, items: await ctx.db.table("exportSchedules").list({ organizationId: ctx.organizationId }) }; }
  catch (error) { if (schemaLag(error)) return { available: false, items: [] }; throw error; }
} });
export const createExportScheduleOp = defineOperation({ name: "exports.schedules.create", capability: "exports:schedule", effect: "write", input: exportScheduleDefinition, entities, run: async (ctx, input) => {
  await validateRecipients(ctx, input.recipientMemberIds);
  if (input.filters.assistantId) await requireAssistant(ctx, input.filters.assistantId);
  try { return await ctx.db.table("exportSchedules").insert({ ...input, organizationId: ctx.organizationId, createdBy: ctx.userId || null }); }
  catch (error) { if (schemaLag(error)) throw new OperationError("invalid_input", "Apply the latest migration to use export schedules"); throw error; }
} });
export const updateExportScheduleOp = defineOperation({ name: "exports.schedules.update", capability: "exports:schedule", effect: "write", input: z.object({ id: z.string().min(1), patch: exportSchedulePatch }), entities, run: async (ctx, { id, patch }) => {
  await requireSchedule(ctx, id); await validateRecipients(ctx, patch.recipientMemberIds);
  if (patch.filters?.assistantId) await requireAssistant(ctx, patch.filters.assistantId);
  return ctx.db.table("exportSchedules").update(id, patch);
} });
export const deleteExportScheduleOp = defineOperation({ name: "exports.schedules.delete", capability: "exports:schedule", effect: "consequential", input: z.object({ id: z.string().min(1) }), entities, run: async (ctx, { id }) => { await requireSchedule(ctx, id); await ctx.db.table("exportSchedules").delete(id); } });
