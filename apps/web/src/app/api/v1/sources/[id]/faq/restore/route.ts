import { restoreFaqVersionOp } from "@ciele/ops";
import { apiError } from "@/lib/api-v1/http";
import { runApiOperation } from "@/lib/api-v1/run";
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const input = await request.json().catch(() => null);
  if (!input) return apiError(400, "invalid_input", "Body must be JSON");
  const outcome = await runApiOperation(request, restoreFaqVersionOp, { sourceId: id, versionId: input.versionId });
  return outcome instanceof Response ? outcome : Response.json({ sourceId: id, documentId: outcome.result.id, question: outcome.result.frontmatter.title ?? "", answer: outcome.result.body });
}
