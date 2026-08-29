import { setDirectAccessOp } from "@ciele/ops";
import { runApiOperation } from "@/lib/api-v1/run";

/** Flip Direct access for one assistant on a file Source (PRD #726). */

type Params = { params: Promise<{ id: string }> };

export async function PUT(request: Request, { params }: Params) {
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as {
    assistantId?: unknown;
    directAccess?: unknown;
  };
  const outcome = await runApiOperation(request, setDirectAccessOp, {
    sourceId: id,
    assistantId: body.assistantId,
    directAccess: body.directAccess,
  });
  if (outcome instanceof Response) return outcome;
  return Response.json({ links: outcome.result });
}
