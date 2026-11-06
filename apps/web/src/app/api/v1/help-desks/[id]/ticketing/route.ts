import { disconnectTicketingIntegrationOp, setTicketingTargetOp } from "@ciele/ops";
import { apiError } from "@/lib/api-v1/http";
import { runApiOperation } from "@/lib/api-v1/run";

/**
 * A desk's ticketing target (#1088, #1089): the Organization-owned Salesforce
 * or ServiceNow Application Connection its "Create a ticket" channel files
 * through. No credential crosses this route; the Connection holds it.
 */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (body === null || typeof body !== "object") {
    return apiError(400, "invalid_input", "Body must be a JSON object");
  }
  const outcome = await runApiOperation(request, setTicketingTargetOp, {
    ...body,
    helpDeskId: id,
  });
  return outcome instanceof Response ? outcome : Response.json(outcome.result);
}

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
