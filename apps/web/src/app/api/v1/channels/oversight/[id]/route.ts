import { readOrgChannelOp } from "@ciele/ops";
import { runApiOperation } from "@/lib/api-v1/run";

/**
 * One channel's transcript for oversight, membership not required.
 *
 * The ordinary read at `GET /channels/{id}` answers `not_found` for a channel
 * the caller is not seated in, never "forbidden": membership is the visibility
 * rule there. This is the deliberate exception, behind `manageMembers`.
 */

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  const outcome = await runApiOperation(request, readOrgChannelOp, { id });
  return outcome instanceof Response ? outcome : Response.json(outcome.result);
}
