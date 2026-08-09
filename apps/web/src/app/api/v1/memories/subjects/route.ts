import { listMemorySubjectsOp } from "@ciele/ops";
import { paginate, parseListParams } from "@/lib/api-v1/http";
import { runApiOperation } from "@/lib/api-v1/run";

export async function GET(request: Request) {
  const outcome = await runApiOperation(request, listMemorySubjectsOp, {});
  if (outcome instanceof Response) return outcome;
  const page = paginate(
    outcome.result.map((subject) => ({ id: subject.subjectId, ...subject })),
    parseListParams(new URL(request.url))
  );
  return Response.json({
    data: page.data.map((subject) => ({
      subjectId: subject.subjectId,
      claimValue: subject.claimValue,
      memoryCount: subject.memoryCount,
      lastMemoryAt: subject.lastMemoryAt,
    })),
    nextCursor: page.nextCursor,
  });
}
