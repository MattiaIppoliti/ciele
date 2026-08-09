import { OrgPinnedDbError } from "@agent-hub/db";
import { OperationError, type Operation, type OperationContext } from "@ciele/ops";
import {
  resolveApiKeyContext,
  requireApiCapability,
  type ApiKeyContext,
} from "@/lib/api-v1/auth";
import { getApiV1Db } from "@/lib/api-v1/db";
import { apiError } from "@/lib/api-v1/http";
import { webOperationPorts } from "@/lib/op-ports";
import { revalidateEntities } from "@/lib/org-mutation";
import { invalidatePublicationFromRoute } from "@/lib/widget-db";

/**
 * The /api/v1 twin of `lib/operations.ts` (#620): authenticate the key,
 * check the operation's declared capability, validate, run against the
 * org-pinned Db, then revalidate the declared entities so the admin UI
 * reflects API-made mutations. Routes shape the JSON; this shapes nothing.
 */
export async function runApiOperation<In, Out>(
  request: Request,
  op: Operation<In, Out>,
  rawInput: unknown
): Promise<{ ctx: ApiKeyContext; result: Out } | Response> {
  const ctx = await resolveApiKeyContext(request);
  if (ctx instanceof Response) return ctx;
  const denied = requireApiCapability(ctx, op.capability);
  if (denied) return denied;

  const parsed = op.input.safeParse(rawInput);
  if (!parsed.success) {
    return apiError(400, "invalid_input", parsed.error.issues[0]?.message ?? "Invalid input");
  }

  const opCtx: OperationContext = {
    organizationId: ctx.organizationId,
    userId: ctx.actorUserId,
    role: ctx.role,
    db: ctx.db,
    // Ports need more Db surface than the pinned view exposes; the raw
    // service Db is confined to them, never handed to operations directly.
    ports: webOperationPorts(getApiV1Db(), {
      organizationId: ctx.organizationId,
      actorEmail: "an API key",
      invalidatePublication: invalidatePublicationFromRoute,
    }),
  };

  let result: Out;
  try {
    result = await op.run(opCtx, parsed.data);
  } catch (error) {
    if (error instanceof OperationError) {
      const status =
        error.code === "not_found" ? 404 : error.code === "conflict" ? 409 : 400;
      return apiError(status, error.code, error.message);
    }
    if (error instanceof OrgPinnedDbError) {
      // cross_org should have been caught by the operation's own not_found
      // guard; if the wrapper fires it anyway, disclose nothing.
      if (error.reason === "cross_org") return apiError(404, "not_found", "Not found");
      throw error; // not_exposed = a server bug (missing allow-list entry)
    }
    throw error;
  }

  try {
    revalidateEntities(op.entities(parsed.data, result));
  } catch {
    // Outside a Next request scope (unit tests) revalidatePath throws;
    // UI freshness is best-effort and must never fail an API call.
  }
  return { ctx, result };
}
