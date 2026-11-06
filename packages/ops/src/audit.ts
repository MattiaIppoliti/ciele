import { AsyncLocalStorage } from "node:async_hooks";
import { reportError } from "@agent-hub/diagnostics";
import type { AuditDescription, AuditLogEntry, Member } from "@agent-hub/core";
import type { OperationContext } from "./operation";
type AuditFacts = Pick<AuditLogEntry, "operation" | "effect" | "entities" | "outcome">;
type AuditCommit = { member: Member; run(entry: Omit<AuditLogEntry, "id" | "createdAt">): Promise<{ auditRecorded: boolean }> };
const auditScope = new AsyncLocalStorage<{ commit?: AuditCommit; description?: AuditDescription }>();
/**
 * Say what this change was about, for the audit log's target and its before
 * and after. Only the outermost operation's entry is written, so a nested
 * operation's description joins it; a later target replaces an earlier one
 * and changes merge by field. Recorded only when the operation succeeds.
 * Describe identities and settings, never a credential, a prompt or text a
 * Visitor wrote: the column has no filter of its own.
 */
export function describeAuditChange(description: AuditDescription): void {
  const scope = auditScope.getStore();
  if (!scope) return;
  scope.description = {
    target: description.target ?? scope.description?.target,
    changes: { ...scope.description?.changes, ...description.changes },
  };
}
function describedFacts() {
  const description = auditScope.getStore()?.description;
  if (!description) return {};
  return {
    targetLabel: description.target?.label ?? null,
    targetDetail: description.target?.detail ?? null,
    changes: description.changes ?? {},
  };
}
/** Nested operations belong to the outer configuration change. */
export function inAuditScope() { return Boolean(auditScope.getStore()); }
export function withAuditScope<T>(work: () => Promise<T>) { return auditScope.run({}, work); }
/** Membership removal waits for the outer operation's result and entity facts. */
export function deferAuditCommit(commit: AuditCommit) {
  const scope = auditScope.getStore();
  if (!scope || scope.commit) throw new Error("An Organization exit is already pending");
  scope.commit = commit;
}
export async function completeAuditOutcome(ctx: OperationContext, facts: AuditFacts) {
  const commit = auditScope.getStore()?.commit;
  if (!commit) return recordAuditOutcome(ctx, facts, describedFacts());
  const result = await commit.run({ ...(await auditEntry(ctx, facts, commit.member)), ...describedFacts() });
  if (!result.auditRecorded) reportError("audit.record", new Error("Self-offboarding audit was unavailable"), { organizationId: ctx.organizationId, operation: facts.operation });
}
export async function auditEntry(ctx: OperationContext, facts: Pick<AuditLogEntry, "operation" | "effect" | "entities" | "outcome">, capturedMember?: Member) {
  const member = capturedMember ?? (await ctx.db.listMembers(ctx.organizationId)).find(row => row.userId === ctx.userId);
  const memberName = member ? [member.firstName, member.lastName].filter(Boolean).join(" ") || member.username || null : ctx.actorName ?? null;
  return { ...facts, organizationId: ctx.organizationId, memberId: ctx.userId || null, memberName, memberEmail: member?.email ?? ctx.actorEmail ?? null, apiKeyId: ctx.apiKeyId ?? null, teammateId: ctx.teammate?.id ?? null, agentAuthor: ctx.agentAuthor ?? null, surface: ctx.surface ?? (ctx.teammate ? "teammate" : ctx.apiKeyId ? "api" : "console") };
}
export async function recordAuditOutcome(
  ctx: OperationContext,
  facts: Pick<AuditLogEntry, "operation" | "effect" | "entities" | "outcome">,
  described: Partial<Pick<AuditLogEntry, "targetLabel" | "targetDetail" | "changes">> = {}
): Promise<void> {
  try {
    await ctx.db.recordAuditEntry({ ...(await auditEntry(ctx, facts)), ...described });
  } catch (error) { reportError("audit.record", error, { organizationId: ctx.organizationId, operation: facts.operation }); }
}
