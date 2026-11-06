import { setAssistantAccessOp } from "@ciele/ops";
import { apiError } from "@/lib/api-v1/http";
import { runApiOperation } from "@/lib/api-v1/run";
type Params = { params: Promise<{ id: string; userId: string }> };
export async function PUT(request: Request, { params }: Params) {
  const { id, userId } = await params;
  const body = await request.json().catch(() => null);
  if (!body) return apiError(400,"invalid_input","Body must be JSON");
  const outcome = await runApiOperation(request,setAssistantAccessOp,{ assistantId:id,userId,role:body.role });
  return outcome instanceof Response ? outcome : new Response(null,{ status:204 });
}
export async function DELETE(request: Request, { params }: Params) {
  const { id, userId } = await params;
  const outcome = await runApiOperation(request,setAssistantAccessOp,{ assistantId:id,userId,role:null });
  return outcome instanceof Response ? outcome : new Response(null,{ status:204 });
}
