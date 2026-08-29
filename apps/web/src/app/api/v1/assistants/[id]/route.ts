import {
  deleteAssistantOp,
  getAssistantOp,
  updateAssistantOp,
} from "@ciele/ops";
import { apiError } from "@/lib/api-v1/http";
import { assistantResource } from "@/lib/api-v1/resources";
import { runApiOperation } from "@/lib/api-v1/run";

/** One Assistant (#620): read, patch, delete, same ops as the admin app. */

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  const outcome = await runApiOperation(request, getAssistantOp, { id });
  if (outcome instanceof Response) return outcome;
  return Response.json(assistantResource(outcome.result));
}

export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params;
  const patch = await request.json().catch(() => null);
  if (patch === null) return apiError(400, "invalid_input", "Body must be JSON");

  const outcome = await runApiOperation(request, updateAssistantOp, { id, patch });
  if (outcome instanceof Response) return outcome;
  return Response.json(assistantResource(outcome.result));
}

export async function DELETE(request: Request, { params }: Params) {
  const { id } = await params;
  const outcome = await runApiOperation(request, deleteAssistantOp, { id });
  if (outcome instanceof Response) return outcome;
  return new Response(null, { status: 204 });
}
