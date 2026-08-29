import { revokeInviteOp } from "@ciele/ops";
import { runApiOperation } from "@/lib/api-v1/run";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const outcome = await runApiOperation(request, revokeInviteOp, { id });
  return outcome instanceof Response ? outcome : new Response(null, { status: 204 });
}
