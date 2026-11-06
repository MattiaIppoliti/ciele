"use server";
import { OperationError, listBusinessHoursOp, createBusinessHoursOp, updateBusinessHoursOp, deleteBusinessHoursOp, setDefaultTimezoneOp } from "@ciele/ops";
import type { BusinessHoursInput, BusinessHoursPatch } from "@agent-hub/core";
import { ZodError } from "zod";
import { runOperation } from "@/lib/operations";
import { CapabilityRefusedError } from "@/lib/authz";
async function attempt<T>(run: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  try { return { ok: true, value: await run() }; }
  catch (error) {
    if (error instanceof ZodError) return { ok: false, error: error.issues.map(issue => issue.message).join(". ") };
    if (error instanceof OperationError || error instanceof CapabilityRefusedError) return { ok: false, error: error.message };
    throw error;
  }
}
export async function listBusinessHoursAction() { return attempt(() => runOperation(listBusinessHoursOp, {})); }
export async function createBusinessHoursAction(input: BusinessHoursInput) { return attempt(() => runOperation(createBusinessHoursOp, input)); }
export async function updateBusinessHoursAction(id: string, patch: BusinessHoursPatch) { return attempt(() => runOperation(updateBusinessHoursOp, { id, patch })); }
export async function deleteBusinessHoursAction(id: string) { return attempt(() => runOperation(deleteBusinessHoursOp, { id })); }
export async function setDefaultTimezoneAction(timezone: string) { return attempt(() => runOperation(setDefaultTimezoneOp, { timezone })); }
