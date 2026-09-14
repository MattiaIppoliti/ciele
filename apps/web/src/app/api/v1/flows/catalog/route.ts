import { flowCatalogOp } from "@ciele/ops";
import { runApiOperation } from "@/lib/api-v1/run";

/**
 * What a Flow may contain: triggers, actions, which pair with which, and the
 * condition kinds this deployment actually implements.
 *
 * A discovery read, so a caller writing a Flow body learns the catalogue
 * instead of inferring it from a rejection. Still key-authenticated, like every
 * other domain read, and still the server's answer rather than a constant in
 * the client, which is what makes an older CLI or MCP server correct against a
 * newer deployment.
 */
export async function GET(request: Request) {
  const outcome = await runApiOperation(request, flowCatalogOp, {});
  if (outcome instanceof Response) return outcome;
  return Response.json(outcome.result);
}
