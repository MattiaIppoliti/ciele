import { checkFaqDuplicatesOp } from "@ciele/ops";
import { apiError } from "@/lib/api-v1/http";
import { runApiOperation } from "@/lib/api-v1/run";
export async function POST(request: Request) {
  const input = await request.json().catch(() => null);
  if (!input) return apiError(400, "invalid_input", "Body must be JSON");
  const outcome = await runApiOperation(request, checkFaqDuplicatesOp, input);
  return outcome instanceof Response ? outcome : Response.json({ data: outcome.result });
}
