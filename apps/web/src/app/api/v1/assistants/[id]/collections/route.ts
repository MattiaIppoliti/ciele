import { listCollectionsOp } from "@ciele/ops";
import { runApiOperation } from "@/lib/api-v1/run";

/** An Assistant's Knowledge Collections (#622). */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const outcome = await runApiOperation(request, listCollectionsOp, {
    assistantId: id,
  });
  if (outcome instanceof Response) return outcome;
  return Response.json({ data: outcome.result });
}
