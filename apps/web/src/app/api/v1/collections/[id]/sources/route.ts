import { addSourceOp, listSourcesOp } from "@ciele/ops";
import { idempotencyScope, withIdempotency } from "@/lib/api-v1/idempotency";
import { sourceResource } from "@/lib/api-v1/resources";
import { runApiOperation } from "@/lib/api-v1/run";
import { intakeSource } from "@/lib/api-v1/source-intake";

/**
 * A Collection's Sources (#622). POST accepts either JSON
 * (`{kind:"text", name, text}` or `{kind:"url", url}`) or multipart with a
 * `file` field. Authorization, extraction and original-binary storage happen at
 * the surface in `intakeSource`; guards + the Source row + the ingestion
 * enqueue live in `addSourceOp`. The response carries the Source's `status`,
 * poll `GET /api/v1/sources/{id}` until it settles.
 *
 * A caller that has no Collection id wants `POST /api/v1/knowledge/sources`,
 * which resolves the org Knowledge Library instead of taking one.
 */

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  const outcome = await runApiOperation(request, listSourcesOp, {
    collectionId: id,
  });
  if (outcome instanceof Response) return outcome;
  return Response.json({ data: outcome.result.map(sourceResource) });
}

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  const scope = await idempotencyScope(request, `POST /collections/${id}/sources`);
  return withIdempotency(request, scope, async () => {
    const intake = await intakeSource(request);
    if (intake instanceof Response) return intake;

    const outcome = await runApiOperation(request, addSourceOp, {
      collectionId: id,
      ...intake,
    });
    if (outcome instanceof Response) return outcome;
    return Response.json(sourceResource(outcome.result.source), { status: 201 });
  });
}
