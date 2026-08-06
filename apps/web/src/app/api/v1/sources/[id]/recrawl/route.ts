import { recrawlSourceOp } from "@ciele/ops";
import { runApiOperation } from "@/lib/api-v1/run";

/** Restart a website Source's crawl (#622). Poll the Source until it settles. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const outcome = await runApiOperation(request, recrawlSourceOp, { id });
  if (outcome instanceof Response) return outcome;
  return Response.json({ ok: true });
}
