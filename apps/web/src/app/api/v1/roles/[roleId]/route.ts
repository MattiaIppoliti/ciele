import { deleteRoleOp, getRoleOp, updateRoleOp } from "@ciele/ops";
import { apiError } from "@/lib/api-v1/http";
import { runApiOperation } from "@/lib/api-v1/run";

type Params = { params: Promise<{ roleId: string }> };

export async function GET(request: Request, { params }: Params) {
  const { roleId: id } = await params;
  const outcome = await runApiOperation(request, getRoleOp, { id });
  return outcome instanceof Response ? outcome : Response.json(outcome.result);
}

export async function PATCH(request: Request, { params }: Params) {
  const { roleId: id } = await params;
  const body = await request.json().catch(() => null);
  if (body === null) return apiError(400, "invalid_input", "Body must be JSON");
  const outcome = await runApiOperation(request, updateRoleOp, { ...body, id });
  return outcome instanceof Response ? outcome : Response.json(outcome.result);
}

export async function DELETE(request: Request, { params }: Params) {
  const { roleId: id } = await params;
  const outcome = await runApiOperation(request, deleteRoleOp, { id });
  return outcome instanceof Response ? outcome : new Response(null, { status: 204 });
}
