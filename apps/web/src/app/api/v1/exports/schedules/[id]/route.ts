import { deleteExportScheduleOp, updateExportScheduleOp } from "@ciele/ops";
import { runApiOperation } from "@/lib/api-v1/run";
type Params = { params: Promise<{ id: string }> };
export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params;
  const outcome = await runApiOperation(request, updateExportScheduleOp, { id, patch: await request.json().catch(() => null) });
  return outcome instanceof Response ? outcome : Response.json(outcome.result);
}
export async function DELETE(request: Request, { params }: Params) {
  const { id } = await params;
  const outcome = await runApiOperation(request, deleteExportScheduleOp, { id });
  return outcome instanceof Response ? outcome : new Response(null, { status: 204 });
}
