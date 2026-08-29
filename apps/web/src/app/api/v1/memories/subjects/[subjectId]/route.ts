import { listSubjectMemoriesOp, wipeSubjectMemoriesOp } from "@ciele/ops";
import { runApiOperation } from "@/lib/api-v1/run";

type Params = { params: Promise<{ subjectId: string }> };
export async function GET(request: Request, { params }: Params) {
  const { subjectId } = await params;
  const outcome = await runApiOperation(request, listSubjectMemoriesOp, { subjectId });
  return outcome instanceof Response ? outcome : Response.json({ data: outcome.result });
}
export async function DELETE(request: Request, { params }: Params) {
  const { subjectId } = await params;
  const outcome = await runApiOperation(request, wipeSubjectMemoriesOp, { subjectId });
  return outcome instanceof Response ? outcome : new Response(null, { status: 204 });
}
