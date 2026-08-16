import { createOrgFaqOp } from "@ciele/ops";
import { apiError } from "@/lib/api-v1/http";
import { idempotencyScope, withIdempotency } from "@/lib/api-v1/idempotency";
import { runApiOperation } from "@/lib/api-v1/run";

/** Add one org-level FAQ: Knowledge Library + explicit links (PRD #726). */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (body === null) return apiError(400, "invalid_input", "Body must be JSON");

  const scope = await idempotencyScope(request, "POST /knowledge/faqs");
  return withIdempotency(request, scope, async () => {
    const outcome = await runApiOperation(request, createOrgFaqOp, {
      question: body.question,
      answer: body.answer,
      assistantIds: body.assistantIds,
    });
    if (outcome instanceof Response) return outcome;
    const { concept } = outcome.result;
    return Response.json(
      {
        id: concept.id,
        sourceId: concept.sourceId,
        question: concept.frontmatter.title,
        answer: concept.body,
        path: concept.path,
      },
      { status: 201 }
    );
  });
}
