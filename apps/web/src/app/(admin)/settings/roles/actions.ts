"use server";

import { createRoleOp, deleteRoleOp, resetRoleOp, setRoleDefaultsOp, updateRoleOp, type RoleView } from "@ciele/ops";
import { runOperation } from "@/lib/operations";

/**
 * Settings → Roles (#1164). Thin: each one runs its operation, which owns the
 * rules (Owner locked, no handing on what you lack, no editing your own Role,
 * no deleting a held one) and the audit entry.
 */

export interface RoleFormInput {
  name: string;
  description: string;
  capabilities: string[];
  organizationLevel: boolean;
  assistantLevel: boolean;
}

export async function createRoleAction(input: RoleFormInput): Promise<RoleView> {
  return runOperation(createRoleOp, input);
}

export async function updateRoleAction(id: string, input: Partial<RoleFormInput>): Promise<RoleView> {
  return runOperation(updateRoleOp, { id, ...input });
}

export async function resetRoleAction(id: string): Promise<RoleView> {
  return runOperation(resetRoleOp, { id });
}

export async function deleteRoleAction(id: string): Promise<void> {
  await runOperation(deleteRoleOp, { id });
}

export async function setRoleDefaultsAction(defaults: { memberRoleId?: string; assistantRoleId?: string }): Promise<RoleView[]> {
  return runOperation(setRoleDefaultsOp, defaults);
}
