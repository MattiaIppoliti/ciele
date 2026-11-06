import { z } from "zod";
import type { BusinessHours, BusinessHoursInput } from "@agent-hub/core";
import { defineOperation, OperationError, type OperationContext } from "./operation";

export const timezoneSchema = z.string().trim().min(1).max(100).refine(value => {
  try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; } catch { return false; }
}, "Use a valid IANA timezone");
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, "Use a valid calendar date");
const range = z.object({ id: z.string().min(1).max(200), opensHour: z.number().int().min(0).max(23), opensMinute: z.number().int().min(0).max(59), closesHour: z.number().int().min(0).max(23), closesMinute: z.number().int().min(0).max(59) }).refine(value => value.opensHour !== value.closesHour || value.opensMinute !== value.closesMinute, "Opening and closing times must differ");
const day = z.object({ enabled: z.boolean(), ranges: z.array(range).max(24) });
const holiday = z.object({ id: z.string().min(1).max(200), name: z.string().trim().min(1).max(120), startDate: dateSchema, endDate: dateSchema, yearly: z.boolean() }).refine(value => value.yearly || value.endDate >= value.startDate, "The holiday end must follow its start");
export const businessHoursInputSchema = z.object({
  name: z.string().trim().min(1).max(120), timezone: timezoneSchema,
  hours: z.object({ monday: day, tuesday: day, wednesday: day, thursday: day, friday: day, saturday: day, sunday: day }),
  holidays: z.array(holiday).max(100), isDefault: z.boolean(),
}) satisfies z.ZodType<BusinessHoursInput>;
const id = z.string().min(1).max(200);
const entities = () => [{ kind: "businessHoursSettings" as const }];
const lag = (error: unknown) => Boolean(error && typeof error === "object" && "code" in error && ["42P01", "42703", "PGRST202", "PGRST204", "PGRST205"].includes(String(error.code)));
export async function requireBusinessHours(ctx: OperationContext, scheduleId: string): Promise<BusinessHours> {
  const schedule = await ctx.db.table("businessHours").get(scheduleId);
  if (!schedule || schedule.organizationId !== ctx.organizationId) throw new OperationError("not_found", "Business hours not found");
  return schedule;
}
async function mutation<T>(work: () => Promise<T>): Promise<T> {
  try { return await work(); } catch (error) {
    if (lag(error)) throw new OperationError("conflict", "Business hours is available after the database migration is applied");
    if (error && typeof error === "object" && "message" in error && typeof error.message === "string" && error.message.startsWith("Business hours is used by:")) throw new OperationError("conflict", error.message);
    throw error;
  }
}
export const listBusinessHoursOp = defineOperation({
  name: "businessHours.list", capability: "businessHours:view", effect: "read", input: z.object({}), entities: () => [],
  run: async ctx => {
    try {
      const items = await ctx.db.table("businessHours").list({ organizationId: ctx.organizationId });
      const organization = (await ctx.db.listOrganizations()).find(row => row.id === ctx.organizationId);
      return { available: true, defaultTimezone: organization?.defaultTimezone ?? "UTC", items: items.sort((a, b) => a.name.localeCompare(b.name)) };
    } catch (error) {
      if (lag(error)) return { available: false, defaultTimezone: "UTC", items: [] as BusinessHours[] };
      throw error;
    }
  },
});
export const createBusinessHoursOp = defineOperation({
  name: "businessHours.create", capability: "businessHours:edit", effect: "write", input: businessHoursInputSchema, entities,
  run: (ctx, input) => mutation(() => ctx.db.saveBusinessHours(ctx.organizationId, null, input)),
});
export const updateBusinessHoursOp = defineOperation({
  name: "businessHours.update", capability: "businessHours:edit", effect: "write", input: z.object({ id, patch: businessHoursInputSchema.partial() }), entities,
  run: (ctx, input) => mutation(async () => {
    const current = await requireBusinessHours(ctx, input.id);
    return ctx.db.saveBusinessHours(ctx.organizationId, input.id, businessHoursInputSchema.parse({ ...current, ...input.patch }));
  }),
});
export const deleteBusinessHoursOp = defineOperation({
  name: "businessHours.delete", capability: "businessHours:edit", effect: "consequential", input: z.object({ id }), entities,
  run: (ctx, input) => mutation(async () => { await requireBusinessHours(ctx, input.id); await ctx.db.deleteBusinessHours(ctx.organizationId, input.id); }),
});
export const setDefaultTimezoneOp = defineOperation({
  name: "businessHours.setTimezone", capability: "businessHours:edit", effect: "write", input: z.object({ timezone: timezoneSchema }), entities,
  run: (ctx, input) => mutation(async () => { await ctx.db.setDefaultTimezone(ctx.organizationId, input.timezone); return { timezone: input.timezone }; }),
});
