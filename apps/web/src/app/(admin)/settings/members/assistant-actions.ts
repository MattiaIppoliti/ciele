"use server";
import { getMemberAssistantAccessOp, setMemberAssistantScopeOp } from "@ciele/ops";
import type { MemberAssistantAccess, MemberAssistantScope } from "@agent-hub/core";
import { runOperation } from "@/lib/operations";

export async function getMemberAssistantAccessAction(userId: string) {
  return runOperation(getMemberAssistantAccessOp, { userId });
}

export async function setMemberAssistantScopeAction(
  userId: string,
  scope: MemberAssistantScope,
  access: MemberAssistantAccess[]
) {
  return runOperation(setMemberAssistantScopeOp, { userId, scope, access });
}
