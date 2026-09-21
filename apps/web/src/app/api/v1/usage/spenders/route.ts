import { readUsageSpendersOp } from "@ciele/ops";
import { runApiOperation } from "@/lib/api-v1/run";

/** Who spent the window's credits (#853), grouped per dimension. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const from = url.searchParams.get("from") ?? undefined;
  const to = url.searchParams.get("to") ?? undefined;
  const outcome = await runApiOperation(request, readUsageSpendersOp, {
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
  });
  return outcome instanceof Response ? outcome : Response.json({ data: outcome.result });
}
