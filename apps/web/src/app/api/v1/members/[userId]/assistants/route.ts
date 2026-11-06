import { getMemberAssistantAccessOp, setMemberAssistantScopeOp } from "@ciele/ops";
import { apiError } from "@/lib/api-v1/http";
import { runApiOperation } from "@/lib/api-v1/run";

type Params = { params: Promise<{ userId: string }> };

/** One Member's Assistant scope and override rows. */
export async function GET(request: Request, { params }: Params) {
  const { userId } = await params;
  const outcome = await runApiOperation(request, getMemberAssistantAccessOp, { userId });
  return outcome instanceof Response ? outcome : Response.json(outcome.result);
}

/**
 * Replace the scope and every override row in one write: `all` with rows as
 * overrides, or `selected` with rows as the whole list the Member reaches.
 */
export async function PUT(request: Request, { params }: Params) {
  const { userId } = await params;
  const body = await request.json().catch(() => null);
  if (body === null) return apiError(400, "invalid_input", "Body must be JSON");
  const outcome = await runApiOperation(request, setMemberAssistantScopeOp, {
    userId,
    scope: body.scope,
    access: body.access,
  });
  return outcome instanceof Response ? outcome : Response.json(outcome.result);
}
