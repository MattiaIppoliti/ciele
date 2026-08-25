import { removeChannelMemberOp } from "@ciele/ops";
import { runApiOperation } from "@/lib/api-v1/run";

type Params = { params: Promise<{ id: string; userId: string }> };

/**
 * Remove a Member, or leave. The operation decides which rule applies: removing
 * somebody else is the manage rule, removing yourself is always allowed.
 */
export async function DELETE(request: Request, { params }: Params) {
  const { id, userId } = await params;
  const outcome = await runApiOperation(request, removeChannelMemberOp, {
    id,
    userId,
  });
  return outcome instanceof Response
    ? outcome
    : new Response(null, { status: 204 });
}
