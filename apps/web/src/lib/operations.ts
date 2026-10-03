import { notFound } from "next/navigation";
import { OperationError, type Operation, type OperationContext } from "@ciele/ops";
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
  const { db, session } = await requireMember(op.capability);
  const input = op.input.parse(rawInput);
  const ctx: OperationContext = {
    organizationId: session.organization.id,
    userId: session.userId,
    role: session.role ?? "viewer",
    actorEmail: session.email,
    actorName: profileName(session.profile) ?? null,
    db,
    ports: webOperationPorts(db, {
      organizationId: session.organization.id,
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
