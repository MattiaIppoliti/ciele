import type { Operation, OperationContext } from "@ciele/ops";
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
    db,
    ports: webOperationPorts(db, {
      organizationId: session.organization.id,
      actorEmail: session.email,
    }),
  };
  const result = await op.run(ctx, input);
  revalidateEntities(op.entities(input, result));
  return result;
}
