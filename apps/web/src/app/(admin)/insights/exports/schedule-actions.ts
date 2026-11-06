"use server";
import { createExportScheduleOp, deleteExportScheduleOp, exportScheduleDefinition, OperationError, updateExportScheduleOp } from "@ciele/ops";
import { runOperation } from "@/lib/operations";
export async function createExportScheduleAction(input: unknown) {
  const parsed = exportScheduleDefinition.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? "Invalid schedule" };
  try { return { ok: true as const, schedule: await runOperation(createExportScheduleOp, parsed.data) }; }
  catch (error) { return { ok: false as const, error: error instanceof OperationError ? error.message : "Could not create the schedule" }; }
}
export async function pauseExportScheduleAction(id: string, enabled: boolean) { await runOperation(updateExportScheduleOp, { id, patch: { enabled } }); }
export async function deleteExportScheduleAction(id: string) { await runOperation(deleteExportScheduleOp, { id }); }
