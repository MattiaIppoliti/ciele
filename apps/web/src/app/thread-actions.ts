"use server";
import type { ThreadTarget } from "@agent-hub/core";
import { listThreadPreferencesOp, setThreadPreferenceOp, deleteThreadOp } from "@ciele/ops";
import { runOperation } from "@/lib/operations";
export async function listThreadPreferencesAction() { return runOperation(listThreadPreferencesOp, {}); }
export async function setThreadPreferenceAction(target: ThreadTarget, action: "archive" | "flag", enabled: boolean) {
  return runOperation(setThreadPreferenceOp, { target, action, enabled });
}
export async function deleteThreadAction(target: ThreadTarget) { await runOperation(deleteThreadOp, target); }
