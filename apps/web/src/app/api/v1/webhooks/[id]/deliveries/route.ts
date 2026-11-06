import { listWebhookDeliveriesOp } from "@ciele/ops";
import { runApiOperation } from "@/lib/api-v1/run";
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const outcome = await runApiOperation(request, listWebhookDeliveriesOp, { id });
  return outcome instanceof Response ? outcome : Response.json({ data: outcome.result });
}
