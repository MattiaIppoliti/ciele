import { resetRoleOp } from "@ciele/ops";
import { runApiOperation } from "@/lib/api-v1/run";

type Params = { params: Promise<{ roleId: string }> };

/** A built-in Role back to today's default Capabilities. */
export async function POST(request: Request, { params }: Params) {
  const { roleId: id } = await params;
  const outcome = await runApiOperation(request, resetRoleOp, { id });
  return outcome instanceof Response ? outcome : Response.json(outcome.result);
}
