import { listMemorySubjectsPageOp } from "@ciele/ops";
import { parseListParams } from "@/lib/api-v1/http";
import { runApiOperation } from "@/lib/api-v1/run";

export async function GET(request: Request) {
  const outcome = await runApiOperation(
    request,
    listMemorySubjectsPageOp,
    parseListParams(new URL(request.url))
  );
  if (outcome instanceof Response) return outcome;
  return Response.json({
    data: outcome.result.items.map((subject) => ({
      subjectId: subject.subjectId,
      claimValue: subject.claimValue,
      memoryCount: subject.memoryCount,
      lastMemoryAt: subject.lastMemoryAt,
    })),
    nextCursor: outcome.result.nextCursor,
  });
}
