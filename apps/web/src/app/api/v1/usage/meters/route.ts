import { readUsageMetersOp } from "@ciele/ops";
import { runApiOperation } from "@/lib/api-v1/run";

/** The plan's meters (#853): cap, credits used and window, per resource. */
export async function GET(request: Request) {
  const outcome = await runApiOperation(request, readUsageMetersOp, {});
  return outcome instanceof Response ? outcome : Response.json({ data: outcome.result });
}
