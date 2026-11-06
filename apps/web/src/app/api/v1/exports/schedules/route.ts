import { createExportScheduleOp, listExportSchedulesOp } from "@ciele/ops";
import { runApiOperation } from "@/lib/api-v1/run";
export async function GET(request: Request) {
  const outcome = await runApiOperation(request, listExportSchedulesOp, {});
  return outcome instanceof Response ? outcome : Response.json(outcome.result);
}
export async function POST(request: Request) {
  const outcome = await runApiOperation(request, createExportScheduleOp, await request.json().catch(() => null));
  return outcome instanceof Response ? outcome : Response.json(outcome.result, { status: 201 });
}
