"use server";
import { OperationError, exportAssistantBundleOp, importAssistantBundleOp } from "@ciele/ops";
import { runOperation } from "@/lib/operations";
export async function exportAssistantBundleAction(assistantId: string) {
  return runOperation(exportAssistantBundleOp, { assistantId });
}
export async function importAssistantBundleAction(bundle: unknown) {
  const parsed = importAssistantBundleOp.input.safeParse({ bundle });
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? "Invalid Assistant bundle" };
  try { return { ok: true as const, result: await runOperation(importAssistantBundleOp, parsed.data) }; }
  catch (error) { return { ok: false as const, error: error instanceof OperationError ? error.message : "Could not import the Assistant bundle" }; }
}
