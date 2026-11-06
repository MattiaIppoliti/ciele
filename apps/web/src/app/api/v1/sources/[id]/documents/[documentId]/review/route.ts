import { setDocumentReviewOp } from "@ciele/ops";
import { runApiOperation } from "@/lib/api-v1/run";
type Params = { params: Promise<{ id: string; documentId: string }> };
async function review(request: Request, params: Params["params"], reviewed: boolean) {
  const { id, documentId } = await params;
  const outcome = await runApiOperation(request, setDocumentReviewOp, { sourceId: id, documentId, reviewed });
  return outcome instanceof Response ? outcome : reviewed ? Response.json(outcome.result) : new Response(null, { status: 204 });
}
export async function POST(request: Request, { params }: Params) { return review(request, params, true); }
export async function DELETE(request: Request, { params }: Params) { return review(request, params, false); }
