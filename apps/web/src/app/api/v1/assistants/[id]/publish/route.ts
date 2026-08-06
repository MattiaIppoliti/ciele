import {
  publicationStatusOp,
  publishAssistantOp,
  unpublishAssistantOp,
} from "@ciele/ops";
import { idempotencyScope, withIdempotency } from "@/lib/api-v1/idempotency";
import { runApiOperation } from "@/lib/api-v1/run";

/**
 * Publication lifecycle (#623): GET = status, POST = publish a new snapshot,
 * DELETE = unpublish. Republish an older version via
 * `POST /api/v1/assistants/{id}/republish`.
 */

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  const outcome = await runApiOperation(request, publicationStatusOp, {
    assistantId: id,
  });
  if (outcome instanceof Response) return outcome;
  return Response.json(outcome.result);
}

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  const scope = await idempotencyScope(request, `POST /assistants/${id}/publish`);
  return withIdempotency(request, scope, async () => {
    const outcome = await runApiOperation(request, publishAssistantOp, {
      assistantId: id,
    });
    if (outcome instanceof Response) return outcome;
    return Response.json(outcome.result, { status: 201 });
  });
}

export async function DELETE(request: Request, { params }: Params) {
  const { id } = await params;
  const outcome = await runApiOperation(request, unpublishAssistantOp, {
    assistantId: id,
  });
  if (outcome instanceof Response) return outcome;
  return new Response(null, { status: 204 });
}
