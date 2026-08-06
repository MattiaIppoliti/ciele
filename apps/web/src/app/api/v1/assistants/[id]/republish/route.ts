import { republishOp } from "@ciele/ops";
import { apiError } from "@/lib/api-v1/http";
import { idempotencyScope, withIdempotency } from "@/lib/api-v1/idempotency";
import { runApiOperation } from "@/lib/api-v1/run";

/** Re-activate an earlier Publication snapshot (#623). Body: { publicationId }. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (body === null) return apiError(400, "invalid_input", "Body must be JSON");

  const scope = await idempotencyScope(request, `POST /assistants/${id}/republish`);
  return withIdempotency(request, scope, async () => {
    const outcome = await runApiOperation(request, republishOp, {
      assistantId: id,
      publicationId: body.publicationId,
    });
    if (outcome instanceof Response) return outcome;
    return Response.json(outcome.result, { status: 201 });
  });
}
