import { disconnectTicketingIntegrationOp } from "@ciele/ops";
import { runApiOperation } from "@/lib/api-v1/run";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const outcome = await runApiOperation(request, disconnectTicketingIntegrationOp, {
    helpDeskId: id,
  });
  return outcome instanceof Response ? outcome : Response.json(outcome.result);
}
