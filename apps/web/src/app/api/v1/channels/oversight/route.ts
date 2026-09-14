import { listOrgChannelsOp } from "@ciele/ops";
import { runApiOperation } from "@/lib/api-v1/run";

/**
 * Every channel in the Organization, membership ignored (#778, story 15).
 *
 * `manageMembers`, and a separate operation rather than a flag on
 * `GET /channels`: a flag on a read is how an oversight surface quietly becomes
 * the default one. `GET /channels` stays the key minter's own roster.
 */
export async function GET(request: Request) {
  const outcome = await runApiOperation(request, listOrgChannelsOp, {});
  return outcome instanceof Response
    ? outcome
    : Response.json({ data: outcome.result });
}
