import { removeMemberOp, updateMemberRoleOp } from "@ciele/ops";
import { apiError } from "@/lib/api-v1/http";
import { runApiOperation } from "@/lib/api-v1/run";

type Params = { params: Promise<{ userId: string }> };

export async function PATCH(request: Request, { params }: Params) {
  const { userId } = await params;
  const body = await request.json().catch(() => null);
  if (body === null) return apiError(400, "invalid_input", "Body must be JSON");
  const outcome = await runApiOperation(request, updateMemberRoleOp, {
    userId,
    role: body.role,
  });
  return outcome instanceof Response ? outcome : Response.json(outcome.result);
}

export async function DELETE(request: Request, { params }: Params) {
  const { userId } = await params;
  const outcome = await runApiOperation(request, removeMemberOp, { userId });
  return outcome instanceof Response ? outcome : new Response(null, { status: 204 });
}
