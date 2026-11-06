"use server";
import { listAssistantAccessOp, listRolesOp, setAssistantAccessOp } from "@ciele/ops";
import type { AssistantAccessRole } from "@agent-hub/core";
import { runOperation } from "@/lib/operations";
import type { AssistantRoleOption } from "@/lib/members/assistant-scope";

/** The Assistant's access rows, and the Roles that can be given on an Assistant. */
export async function listAssistantAccessAction(assistantId: string) {
  const [members, roles] = await Promise.all([
    runOperation(listAssistantAccessOp, { assistantId }),
    runOperation(listRolesOp, {}),
  ]);
  return { members, roles: assistantRoleOptions(roles) };
}

/** `denied`, a Role id, or null to fall back to the Organization Role. */
export async function setAssistantAccessAction(assistantId: string, userId: string, choice: "denied" | string | null) {
  const role: AssistantAccessRole | null = choice === "denied" ? "denied" : choice === null ? null : "viewer";
  return runOperation(setAssistantAccessOp, {
    assistantId,
    userId,
    role,
    ...(choice && choice !== "denied" ? { roleId: choice } : {}),
  });
}

function assistantRoleOptions(roles: Array<{ id: string; name: string; key: string | null; assistantLevel: boolean; assistantDefault: boolean }>): AssistantRoleOption[] {
  return roles
    .filter((role) => role.assistantLevel)
    .map((role) => ({ id: role.id, name: role.name, key: role.key, assistantDefault: role.assistantDefault }));
}
