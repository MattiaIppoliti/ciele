import { removeChannelTeammateOp } from "@ciele/ops";
import { runApiOperation } from "@/lib/api-v1/run";

type Params = { params: Promise<{ id: string; teammateId: string }> };

export async function DELETE(request: Request, { params }: Params) {
  const { id, teammateId } = await params;
  const outcome = await runApiOperation(request, removeChannelTeammateOp, {
    id,
    teammateId,
  });
  return outcome instanceof Response
    ? outcome
    : new Response(null, { status: 204 });
}
