import { addOrgSourceOp, listOrgKnowledgeSourcesOp } from "@ciele/ops";
import { idempotencyScope, withIdempotency } from "@/lib/api-v1/idempotency";
import { sourceResource } from "@/lib/api-v1/resources";
import { runApiOperation } from "@/lib/api-v1/run";
import { intakeSource } from "@/lib/api-v1/source-intake";

/**
 * Org-wide knowledge items (PRD #726): the hub's table, for API consumers.
 * `kinds` is a comma list (defaults to every kind); the rest mirror the hub
 * filters.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const num = (name: string) => {
    const raw = url.searchParams.get(name);
    const value = raw === null ? NaN : Number.parseInt(raw, 10);
    return Number.isFinite(value) ? value : undefined;
  };
  const outcome = await runApiOperation(request, listOrgKnowledgeSourcesOp, {
    kinds: (url.searchParams.get("kinds") ?? "website,url,file,text,application,faq")
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean),
    status: url.searchParams.get("status") ?? undefined,
    assistantId: url.searchParams.get("assistantId") ?? undefined,
    query: url.searchParams.get("q") ?? undefined,
    page: num("page"),
    pageSize: num("pageSize"),
  });
  if (outcome instanceof Response) return outcome;
  const { items, total, statusCounts } = outcome.result;
  return Response.json({
    items: items.map((item) => ({
      id: item.id,
      collectionId: item.collectionId,
      name: item.name,
      kind: item.kind,
      status: item.status,
      conceptCount: item.conceptCount,
      answerPreview: item.answerPreview,
      linkedAssistants: item.linkedAssistants,
      lastCrawledAt: item.lastCrawledAt,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    })),
    total,
    statusCounts,
  });
}

/**
 * Add a knowledge Source without naming a Collection: the org-level door the
 * console has had since PRD #726 and `/api/v1` did not. `addOrgSourceOp`
 * resolves the per-org Knowledge Library, so a caller holding nothing but an
 * Assistant id can add knowledge to it, which
 * `POST /api/v1/collections/{id}/sources` cannot do for a new Assistant: the
 * Collection list it needs is derived from Sources already linked there.
 *
 * Same body as that route (JSON text/url, or multipart `file`) plus the
 * required `assistantIds` links, and the same `status`-then-poll contract.
 */
export async function POST(request: Request) {
  const scope = await idempotencyScope(request, "POST /knowledge/sources");
  return withIdempotency(request, scope, async () => {
    const intake = await intakeSource(request);
    if (intake instanceof Response) return intake;

    const outcome = await runApiOperation(request, addOrgSourceOp, intake);
    if (outcome instanceof Response) return outcome;
    return Response.json(sourceResource(outcome.result.source), { status: 201 });
  });
}
