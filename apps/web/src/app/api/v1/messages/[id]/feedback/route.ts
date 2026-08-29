import { setMessageFeedbackOp } from "@ciele/ops";
import { apiError } from "@/lib/api-v1/http";
import { runApiOperation } from "@/lib/api-v1/run";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (body === null) return apiError(400, "invalid_input", "Body must be JSON");
  const outcome = await runApiOperation(request, setMessageFeedbackOp, {
    messageId: id,
    feedback: body.feedback,
  });
  return outcome instanceof Response ? outcome : Response.json(outcome.result);
}
