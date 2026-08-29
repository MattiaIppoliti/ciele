import { deleteAssistantGoalOp, updateAssistantGoalOp } from "@ciele/ops";
import { apiError } from "@/lib/api-v1/http";
import { runApiOperation } from "@/lib/api-v1/run";

type Params = { params: Promise<{ id: string; goalId: string }> };

export async function PATCH(request: Request, { params }: Params) {
  const { id, goalId } = await params;
  const patch = await request.json().catch(() => null);
  if (patch === null) return apiError(400, "invalid_input", "Body must be JSON");
  const outcome = await runApiOperation(request, updateAssistantGoalOp, {
    assistantId: id,
    goalId,
    patch,
  });
  return outcome instanceof Response ? outcome : Response.json(outcome.result);
}

export async function DELETE(request: Request, { params }: Params) {
  const { id, goalId } = await params;
  const outcome = await runApiOperation(request, deleteAssistantGoalOp, {
    assistantId: id,
    goalId,
  });
  return outcome instanceof Response ? outcome : new Response(null, { status: 204 });
}
