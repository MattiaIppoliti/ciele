import { getReviewOp } from "@ciele/ops";
import { runApiOperation } from "@/lib/api-v1/run";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  const outcome = await runApiOperation(request, getReviewOp, { id });
  return outcome instanceof Response ? outcome : Response.json(outcome.result);
}
