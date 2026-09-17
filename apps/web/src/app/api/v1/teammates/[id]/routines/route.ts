import { createRoutineOp, listRoutinesOp } from "@ciele/ops";
import { apiError } from "@/lib/api-v1/http";
import { idempotencyScope, withIdempotency } from "@/lib/api-v1/idempotency";
import { runApiOperation } from "@/lib/api-v1/run";

/**
 * A Teammate's Routines (#772): standing instructions it runs unattended on a
 * daily, weekly or monthly cadence at a chosen UTC hour.
 *
 * Listing is `member`, because unattended work an agent does in your workspace
 * is not a secret from you. Creating takes the Teammate's own `edit` rule: what
 * it does when nobody is watching is not a different question from what it is.
 * Five per Teammate, refused here with a sentence and by a trigger underneath.
 */

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  const outcome = await runApiOperation(request, listRoutinesOp, {
    teammateId: id,
  });
  return outcome instanceof Response
    ? outcome
    : Response.json({ data: outcome.result });
}

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  // The registry promises idempotency here and the client sends the header, so
  // the route has to read it: five Routines is the cap, and a retried create
  // otherwise spends one of them and attaches a second unattended schedule.
  const scope = await idempotencyScope(request, `POST /teammates/${id}/routines`);
  return withIdempotency(request, scope, async () => {
    const body = await request.json().catch(() => null);
    if (body === null) return apiError(400, "invalid_input", "Body must be JSON");
    const outcome = await runApiOperation(request, createRoutineOp, {
      teammateId: id,
      ...body,
    });
    return outcome instanceof Response
      ? outcome
      : Response.json(outcome.result, { status: 201 });
  });
}
