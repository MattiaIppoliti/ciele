import { getTeammateMemoryOp, writeTeammateMemoryOp } from "@ciele/ops";
import { apiError } from "@/lib/api-v1/http";
import { runApiOperation } from "@/lib/api-v1/run";

/**
 * The Agent memory layer (#771): what one Teammate has learned, as one
 * document with its append-only history.
 *
 * Org-scoped, so a key may read and write it. Its sibling, the User layer, is
 * deliberately absent from `/api/v1`: that document's RLS is
 * `member_id = auth.uid()` and nothing else, admins included, and a key acts as
 * the Member who minted it, so an endpoint would hand anyone holding the key
 * that Member's private profile.
 *
 * Writing takes the Teammate's own `edit` rule: a wrong learning is corrected
 * by whoever maintains the Teammate.
 */

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  const outcome = await runApiOperation(request, getTeammateMemoryOp, { id });
  return outcome instanceof Response ? outcome : Response.json(outcome.result);
}

export async function PUT(request: Request, { params }: Params) {
  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (body === null) return apiError(400, "invalid_input", "Body must be JSON");
  const outcome = await runApiOperation(request, writeTeammateMemoryOp, {
    id,
    ...body,
  });
  return outcome instanceof Response ? outcome : Response.json(outcome.result);
}
