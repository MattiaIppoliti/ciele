import { afterEach, expect, it } from "vitest";
import { defaultChannelAvailability } from "@agent-hub/core";
import { DEMO_MEMBER, DEMO_ORG, getMockDb } from "@agent-hub/db";
import type { OperationContext } from "./operation";
import { businessHoursInputSchema, createBusinessHoursOp, deleteBusinessHoursOp, listBusinessHoursOp, setDefaultTimezoneOp, updateBusinessHoursOp } from "./business-hours";
import { createSupportChannelOp } from "./help-desks";
import { createFlowOp, draftFlowOp, proposeFlowOp } from "./flows";
const db = getMockDb();
const ctx: OperationContext = { organizationId: DEMO_ORG.id, userId: DEMO_MEMBER.userId, role: "editor", db, ports: {} };
const input = { name: "Office", timezone: "Europe/Rome", hours: defaultChannelAvailability().hours, holidays: [], isDefault: true };
afterEach(async () => { await db.setDefaultTimezone(DEMO_ORG.id, "UTC"); });
it("validates real dates, overnight windows and timezone values", () => {
  expect(businessHoursInputSchema.safeParse({ ...input, timezone: "invented/zone" }).success).toBe(false);
  expect(businessHoursInputSchema.safeParse({ ...input, holidays: [{ id: "bad", name: "Invalid", startDate: "2026-02-30", endDate: "2026-03-01", yearly: false }] }).success).toBe(false);
  expect(businessHoursInputSchema.safeParse({ ...input, hours: { ...input.hours, monday: { enabled: true, ranges: [{ id: "night", opensHour: 22, opensMinute: 0, closesHour: 2, closesMinute: 0 }] } } }).success).toBe(true);
});
it("uses the Organization timezone for new channels and refuses foreign or missing schedules", async () => {
  await setDefaultTimezoneOp.run(ctx, { timezone: "Pacific/Auckland" });
  const desk = await db.createHelpDesk(DEMO_ORG.id, { name: "Hours" });
  const channel = await createSupportChannelOp.run(ctx, { helpDeskId: desk.id, input: { name: "Email", kind: "email" } });
  expect(channel.availability.timezone).toBe("Pacific/Auckland");
  await expect(createSupportChannelOp.run(ctx, { helpDeskId: desk.id, input: { name: "Missing", kind: "email", availability: { ...defaultChannelAvailability(), mode: "business_hours", businessHoursId: "missing" } } })).rejects.toThrow(/not found/i);
  const schedule = await createBusinessHoursOp.run(ctx, input);
  expect(await listBusinessHoursOp.run(ctx, {})).toMatchObject({ available: true, defaultTimezone: "Pacific/Auckland" });
  await expect(updateBusinessHoursOp.run({ ...ctx, organizationId: "other-org" }, { id: schedule.id, patch: { name: "Stolen" } })).rejects.toThrow(/not found/i);
  await deleteBusinessHoursOp.run(ctx, { id: schedule.id });
  await db.deleteHelpDesk(desk.id);
});
it("keeps missing schedule validation and proactive restrictions on every write surface", async () => {
  const assistant = await db.createAssistant(DEMO_ORG.id, { title: "Schedule validation" });
  const condition = { id: "s", kind: "schedule", mode: "business_hours", direction: "outside", businessHoursId: "missing" } as const;
  await expect(createFlowOp.run(ctx, { assistantId: assistant.id, input: { name: "Missing", conditions: [condition] } })).rejects.toThrow(/not found/i);
  await expect(draftFlowOp.run(ctx, { summary: "Invalid reference", currentTrigger: "message", patch: { conditions: [condition] } })).rejects.toThrow(/not found/i);
  await expect(proposeFlowOp.run(ctx, { assistantId: assistant.id, rationale: "Invalid reference", flow: { name: "Missing", conditions: [condition] } })).rejects.toThrow(/not found/i);
  const schedule = await createBusinessHoursOp.run(ctx, input);
  await expect(draftFlowOp.run(ctx, { summary: "Missing trigger context", patch: { conditions: [{ ...condition, businessHoursId: schedule.id }] } })).rejects.toThrow(/currentTrigger/);
  await expect(draftFlowOp.run(ctx, { summary: "Proactive", currentTrigger: "page_load", patch: { conditions: [{ ...condition, businessHoursId: schedule.id }] } })).rejects.toThrow(/cannot have conditions/i);
  await expect(proposeFlowOp.run(ctx, { assistantId: assistant.id, rationale: "Proactive", flow: { name: "Proactive", trigger: "page_load", actions: ["notification"], conditions: [{ ...condition, businessHoursId: schedule.id }] } })).rejects.toThrow(/cannot have conditions/i);
  await expect(createFlowOp.run(ctx, { assistantId: assistant.id, input: { name: "Proactive", trigger: "page_load", actions: ["notification"], conditions: [{ ...condition, businessHoursId: schedule.id }] } })).rejects.toThrow(/cannot have conditions/i);
  await deleteBusinessHoursOp.run(ctx, { id: schedule.id });
});
it("reports schema lag as unavailable and refuses writes with setup guidance", async () => {
  const unavailable = { ...db, table: () => { throw Object.assign(new Error("Not migrated"), { code: "42P01" }); }, saveBusinessHours: async () => { throw Object.assign(new Error("Not migrated"), { code: "PGRST202" }); } };
  expect(await listBusinessHoursOp.run({ ...ctx, db: unavailable }, {})).toEqual({ available: false, defaultTimezone: "UTC", items: [] });
  await expect(createBusinessHoursOp.run({ ...ctx, db: unavailable }, input)).rejects.toThrow(/migration/);
});
