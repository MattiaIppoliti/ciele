import { deleteApiIntegrationOp, getApiIntegrationOp, setApiIntegrationOp } from "@ciele/ops";
import { apiError } from "@/lib/api-v1/http";
import { runApiOperation } from "@/lib/api-v1/run";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  const outcome = await runApiOperation(request, getApiIntegrationOp, {
    assistantId: id,
  });
  return outcome instanceof Response ? outcome : Response.json(outcome.result);
}

export async function PUT(request: Request, { params }: Params) {
  const { id } = await params;
  const input = await request.json().catch(() => null);
  if (input === null) return apiError(400, "invalid_input", "Body must be JSON");
  const outcome = await runApiOperation(request, setApiIntegrationOp, {
    assistantId: id,
    input,
  });
  return outcome instanceof Response ? outcome : Response.json(outcome.result);
}

export async function DELETE(request: Request, { params }: Params) {
  const { id } = await params;
  const outcome = await runApiOperation(request, deleteApiIntegrationOp, {
    assistantId: id,
  });
  return outcome instanceof Response ? outcome : new Response(null, { status: 204 });
}
