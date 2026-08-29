import { deleteSupportChannelOp, updateSupportChannelOp } from "@ciele/ops";
import { apiError } from "@/lib/api-v1/http";
import { runApiOperation } from "@/lib/api-v1/run";

type Params = { params: Promise<{ id: string; channelId: string }> };

export async function PATCH(request: Request, { params }: Params) {
  const { id, channelId } = await params;
  const patch = await request.json().catch(() => null);
  if (patch === null) return apiError(400, "invalid_input", "Body must be JSON");
  const outcome = await runApiOperation(request, updateSupportChannelOp, {
    helpDeskId: id,
    channelId,
    patch,
  });
  return outcome instanceof Response ? outcome : Response.json(outcome.result);
}

export async function DELETE(request: Request, { params }: Params) {
  const { id, channelId } = await params;
  const outcome = await runApiOperation(request, deleteSupportChannelOp, {
    helpDeskId: id,
    channelId,
  });
  return outcome instanceof Response ? outcome : new Response(null, { status: 204 });
}
