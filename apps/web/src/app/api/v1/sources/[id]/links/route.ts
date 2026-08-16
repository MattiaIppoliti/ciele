import { setSourceLinksOp } from "@ciele/ops";
import { runApiOperation } from "@/lib/api-v1/run";

/** Replace a Source's linked-assistant set (PRD #726). */

type Params = { params: Promise<{ id: string }> };

export async function PUT(request: Request, { params }: Params) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const outcome = await runApiOperation(request, setSourceLinksOp, {
    sourceId: id,
    assistantIds: (body as { assistantIds?: unknown }).assistantIds,
  });
  if (outcome instanceof Response) return outcome;
  return Response.json({ links: outcome.result });
}
