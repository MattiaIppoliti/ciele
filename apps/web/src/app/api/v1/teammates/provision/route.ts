import { provisionTeammateOp } from "@ciele/ops";
import { apiError } from "@/lib/api-v1/http";
import { idempotencyScope, withIdempotency } from "@/lib/api-v1/idempotency";
import { runApiOperation } from "@/lib/api-v1/run";

/**
 * Stand up a working Teammate in one call: persona, then grants, then routines.
 *
 * The one composite endpoint on this surface, and it exists because the three
 * calls it replaces are a sequence nobody can infer from the endpoints alone.
 * It adds no reach: each step runs the operation that owns its own capability,
 * so granting still needs an admin-tier key and is reported as `partial:
 * "grants"` rather than throwing away the Teammate that was already created.
 */
export async function POST(request: Request) {
  const scope = await idempotencyScope(request, "POST /teammates/provision");
  return withIdempotency(request, scope, async () => {
    const body = await request.json().catch(() => null);
    if (body === null) return apiError(400, "invalid_input", "Body must be JSON");
    const outcome = await runApiOperation(request, provisionTeammateOp, body);
    return outcome instanceof Response
      ? outcome
      : Response.json(outcome.result, { status: 201 });
  });
}
