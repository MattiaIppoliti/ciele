import { listOrgKnowledgeSourcesOp } from "@ciele/ops";
import { runApiOperation } from "@/lib/api-v1/run";

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
    kinds: (url.searchParams.get("kinds") ?? "website,url,file,text,faq")
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
