import { deleteSourceOp, getSourceOp } from "@ciele/ops";
import { sourceResource } from "@/lib/api-v1/resources";
import { runApiOperation } from "@/lib/api-v1/run";

/** One Source (#622): status poll + delete. */

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  const outcome = await runApiOperation(request, getSourceOp, { id });
  if (outcome instanceof Response) return outcome;
  return Response.json(sourceResource(outcome.result));
}

export async function DELETE(request: Request, { params }: Params) {
  const { id } = await params;
  const outcome = await runApiOperation(request, deleteSourceOp, { id });
  if (outcome instanceof Response) return outcome;
  return new Response(null, { status: 204 });
}
