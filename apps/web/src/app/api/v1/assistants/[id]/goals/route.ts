import { createAssistantGoalOp, listAssistantGoalsOp } from "@ciele/ops";
import { apiError } from "@/lib/api-v1/http";
import { runApiOperation } from "@/lib/api-v1/run";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  const outcome = await runApiOperation(request, listAssistantGoalsOp, {
    assistantId: id,
  });
  return outcome instanceof Response ? outcome : Response.json({ data: outcome.result });
}

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (body === null) return apiError(400, "invalid_input", "Body must be JSON");
  const outcome = await runApiOperation(request, createAssistantGoalOp, {
    assistantId: id,
    ...body,
  });
  return outcome instanceof Response
    ? outcome
    : Response.json(outcome.result, { status: 201 });
}
