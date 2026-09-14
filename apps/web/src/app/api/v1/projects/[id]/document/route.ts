import { writeProjectDocumentOp } from "@ciele/ops";
import { apiError } from "@/lib/api-v1/http";
import { runApiOperation } from "@/lib/api-v1/run";

/**
 * The Project memory layer: one document, injected whole into every turn a
 * Teammate attached to this Project takes.
 *
 * PUT rather than PATCH: the body is replaced, and the previous body is kept in
 * the append-only history as `body_before`, which is what makes a revert a
 * restore rather than a guess. Read it through `GET /api/v1/projects/{id}`.
 */

type Params = { params: Promise<{ id: string }> };

export async function PUT(request: Request, { params }: Params) {
  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (body === null) return apiError(400, "invalid_input", "Body must be JSON");
  const outcome = await runApiOperation(request, writeProjectDocumentOp, {
    id,
    ...body,
  });
  return outcome instanceof Response ? outcome : Response.json(outcome.result);
}
