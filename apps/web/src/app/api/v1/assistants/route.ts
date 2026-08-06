import { createAssistantOp, listAssistantsOp } from "@ciele/ops";
import { apiError, paginate, parseListParams } from "@/lib/api-v1/http";
import { idempotencyScope, withIdempotency } from "@/lib/api-v1/idempotency";
import { assistantResource } from "@/lib/api-v1/resources";
import { runApiOperation } from "@/lib/api-v1/run";

/**
 * Assistants collection (#620): list and create, both running the same
 * operations the admin app's server actions run. The former #619 tracer
 * read now goes through `listAssistantsOp` like everything else.
 */

export async function GET(request: Request) {
  const outcome = await runApiOperation(request, listAssistantsOp, {});
  if (outcome instanceof Response) return outcome;

  const page = paginate(outcome.result, parseListParams(new URL(request.url)));
  return Response.json({
    data: page.data.map(assistantResource),
    nextCursor: page.nextCursor,
  });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (body === null) return apiError(400, "invalid_input", "Body must be JSON");

  const scope = await idempotencyScope(request, "POST /assistants");
  return withIdempotency(request, scope, async () => {
    const outcome = await runApiOperation(request, createAssistantOp, body);
    if (outcome instanceof Response) return outcome;
    return Response.json(assistantResource(outcome.result), { status: 201 });
  });
}
