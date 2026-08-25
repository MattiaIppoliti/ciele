import { addChannelMembersOp } from "@ciele/ops";
import { apiError } from "@/lib/api-v1/http";
import { runApiOperation } from "@/lib/api-v1/run";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (body === null) return apiError(400, "invalid_input", "Body must be JSON");
  const outcome = await runApiOperation(request, addChannelMembersOp, {
    id,
    userIds: (body as { userIds?: unknown }).userIds,
  });
  return outcome instanceof Response
    ? outcome
    : new Response(null, { status: 204 });
}
