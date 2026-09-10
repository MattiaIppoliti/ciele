import { listApplicationConnectionsOp } from "@ciele/ops";
import { runApiOperation } from "@/lib/api-v1/run";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const provider = url.searchParams.get("provider") ?? undefined;
  const outcome = await runApiOperation(request, listApplicationConnectionsOp, {
    ...(provider ? { provider } : {}),
  });
  return outcome instanceof Response ? outcome : Response.json({ data: outcome.result });
}
