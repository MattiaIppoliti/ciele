import { draftFlowOp } from "@ciele/ops";
import { apiError } from "@/lib/api-v1/http";
import { runApiOperation } from "@/lib/api-v1/run";

/**
 * Check a Flow **patch** without storing it, and see what would be stored.
 *
 * The Flows Agent's own drafting tool, reachable by any author. It mutates
 * nothing (`entities: () => []`); what it returns is the patch after the two
 * rules that are easy to forget and cannot be read off the schema: the
 * trigger/action pairing rule, and the human-review gate inserted before a
 * Connector write (#841). An author who posts here first learns that the
 * runtime will add a `human_review` action, rather than discovering it in a
 * saved Flow.
 *
 * `currentTrigger` is how the caller says which trigger the actions will run
 * on, since a patch to the actions alone does not carry one.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (body === null) return apiError(400, "invalid_input", "Body must be JSON");
  const outcome = await runApiOperation(request, draftFlowOp, body);
  return outcome instanceof Response ? outcome : Response.json(outcome.result);
}
