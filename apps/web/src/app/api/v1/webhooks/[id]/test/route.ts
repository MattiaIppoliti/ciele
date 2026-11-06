import { sendWebhookTestOp } from "@ciele/ops";
import { runApiOperation } from "@/lib/api-v1/run";
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const outcome = await runApiOperation(request, sendWebhookTestOp, { id });
  return outcome instanceof Response ? outcome : Response.json(outcome.result, { status: 202 });
}
