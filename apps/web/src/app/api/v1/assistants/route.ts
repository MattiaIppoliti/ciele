import { createAssistantOp, listAssistantsPageOp } from "@ciele/ops";
import { apiError, parseListParams } from "@/lib/api-v1/http";
import { idempotencyRequestHash, idempotencyScope, withIdempotency } from "@/lib/api-v1/idempotency";
import { assistantResource } from "@/lib/api-v1/resources";
import { runApiOperation } from "@/lib/api-v1/run";

/**
 * Assistants collection (#620): list and create, both running the same
 * operations the admin app's server actions run. The former #619 tracer
 * read now goes through `listAssistantsOp` like everything else.
 */

export async function GET(request: Request) {
  const outcome = await runApiOperation(
    request,
    listAssistantsPageOp,
    parseListParams(new URL(request.url))
  );
  if (outcome instanceof Response) return outcome;
  return Response.json({
    data: outcome.result.items.map(assistantResource),
    nextCursor: outcome.result.nextCursor,
  });
}

export async function POST(request: Request) {
  const requestHash = await idempotencyRequestHash(request);
  const body = await request.json().catch(() => null);
  if (body === null) return apiError(400, "invalid_input", "Body must be JSON");

  const scope = await idempotencyScope(request, "POST /assistants");
  return withIdempotency(request, scope, async () => {
    const outcome = await runApiOperation(request, createAssistantOp, body);
    if (outcome instanceof Response) return outcome;
    return Response.json(assistantResource(outcome.result), { status: 201 });
  }, requestHash);
}
