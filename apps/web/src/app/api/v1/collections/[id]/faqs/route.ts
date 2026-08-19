import { createFaqOp } from "@ciele/ops";
import { apiError } from "@/lib/api-v1/http";
import { idempotencyScope, withIdempotency } from "@/lib/api-v1/idempotency";
import { runApiOperation } from "@/lib/api-v1/run";

/** Add one FAQ (question + answer) to a Collection (#622). */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (body === null) return apiError(400, "invalid_input", "Body must be JSON");

  const scope = await idempotencyScope(request, `POST /collections/${id}/faqs`);
  return withIdempotency(request, scope, async () => {
    const outcome = await runApiOperation(request, createFaqOp, {
      collectionId: id,
      question: body.question,
      answer: body.answer,
      // PRD #726 contract: the caller names the Assistants this FAQ links to.
      assistantIds: Array.isArray(body.assistantIds)
        ? (body.assistantIds as unknown[]).map((id) => String(id))
        : undefined,
    });
    if (outcome instanceof Response) return outcome;
    const { concept } = outcome.result;
    return Response.json(
      {
        id: concept.id,
        question: concept.frontmatter.title,
        answer: concept.body,
        path: concept.path,
      },
      { status: 201 }
    );
  });
}
