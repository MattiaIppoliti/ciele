import { notFound } from "next/navigation";
import { OperationError, operationAssistantId, type Operation, type OperationContext } from "@ciele/ops";
import { isAssistantLevelCapability } from "@agent-hub/core";
import { withDiagnosticContext } from "@agent-hub/diagnostics";
import { profileName } from "@/lib/auth";
import { requireMember } from "@/lib/authz";
import { webOperationPorts } from "@/lib/op-ports";
import { revalidateEntities } from "@/lib/org-mutation";

/**
 * The web surface's adapter over the operations layer (#620): resolve the
 * signed-in Member with the operation's declared capability, validate,
 * run against the session's RLS-scoped Db, then revalidate the declared
 * entities. Server actions delegate here; the /api/v1 twin lives in
 * `api-v1/run.ts`: same operation, different context resolution.
 */
export async function runOperation<In, Out>(
  op: Operation<In, Out>,
  rawInput: In
): Promise<Out> {
  // An Organization-level operation is refused before its input is read. An
  // Assistant-level one needs its input first: the Member's Role on that
  // Assistant decides, and the input is what names the Assistant.
  const assistantLevel = op.capability !== "member" && isAssistantLevelCapability(op.capability);
  const early = assistantLevel ? null : await requireMember(op.capability);
  const input = op.input.parse(rawInput);
  const { db, session, capabilities } = early ?? await requireMember(op.capability, {
    assistantId: (db) =>
      operationAssistantId({ organizationId: "", userId: "", role: "viewer", db, ports: {} } as OperationContext, op, input),
  });
  const ctx: OperationContext = {
    organizationId: session.organization.id,
    userId: session.userId,
    role: session.role ?? "viewer",
    capabilities,
    actorEmail: session.email,
    actorName: profileName(session.profile) ?? null,
    db,
    // The Member's own RLS session, which the Rust service rebuilds for a forwarded operation.
    dbScope: "session",
    ports: webOperationPorts(db, {
      organizationId: session.organization.id,
      memberId: session.userId,
      actorEmail: session.email,
    }),
  };
  return withDiagnosticContext({ surface: "console" }, async () => {
    const result = await op.run(ctx, input);
    revalidateEntities(op.entities(input, result), session.organization.id);
    return result;
  });
}

/**
 * `runOperation` for a page render: an operation's `not_found` becomes the
 * route's 404. A row in another Organization and a row that never existed
 * answer the same way, so the console does not confirm that someone else's
 * row exists. Anything else is a real failure and keeps being one.
 */
export async function runPageOperation<In, Out>(
  op: Operation<In, Out>,
  rawInput: In
): Promise<Out> {
  try {
    return await runOperation(op, rawInput);
  } catch (error) {
    if (error instanceof OperationError && error.code === "not_found") notFound();
    throw error;
  }
}
