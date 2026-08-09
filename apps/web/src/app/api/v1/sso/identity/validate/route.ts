import { validateSsoIdentityOp } from "@ciele/ops";
import { runApiOperation } from "@/lib/api-v1/run";

export async function POST(request: Request) {
  const outcome = await runApiOperation(request, validateSsoIdentityOp, {});
  return outcome instanceof Response ? outcome : Response.json(outcome.result);
}
