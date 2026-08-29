import { listProviderConnectionsOp } from "@ciele/ops";
import { runApiOperation } from "@/lib/api-v1/run";

export async function GET(request: Request) {
  const outcome = await runApiOperation(request, listProviderConnectionsOp, {});
  return outcome instanceof Response ? outcome : Response.json({ data: outcome.result });
}
