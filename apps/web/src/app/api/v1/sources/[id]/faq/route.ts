import { getOrgFaqOp, updateOrgFaqOp } from "@ciele/ops";
import { apiError } from "@/lib/api-v1/http";
import { runApiOperation } from "@/lib/api-v1/run";
type Params = { params: Promise<{ id: string }> };
export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  const outcome = await runApiOperation(request, getOrgFaqOp, { sourceId: id });
  return outcome instanceof Response ? outcome : Response.json(outcome.result);
}
export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params;
  const input = await request.json().catch(() => null);
  if (!input) return apiError(400, "invalid_input", "Body must be JSON");
  const outcome = await runApiOperation(request, updateOrgFaqOp, { sourceId: id, question: input.question, answer: input.answer });
  return outcome instanceof Response ? outcome : Response.json({ sourceId: id, documentId: outcome.result.id, question: outcome.result.frontmatter.title ?? "", answer: outcome.result.body });
}
