import { notFound } from "next/navigation";
import { KnowledgeHubClient } from "@/components/knowledge/knowledge-hub-client";
import { requirePageMember } from "@/lib/authz";
import { canEdit } from "@/lib/rbac";
import {
  HUB_PAGE_SIZE,
  KNOWLEDGE_TAB_KINDS,
  KNOWLEDGE_TAB_SLUGS,
  isKnowledgeTabSlug,
  parseHubSearchParams,
} from "@/lib/knowledge-hub";

export const dynamic = "force-dynamic";

/**
 * The org-level Library (PRD #726): one tab per Source-kind bucket
 * (Websites / Files / FAQs), every read org-scoped through the Db seam, all
 * filtering and pagination server-side via URL search params.
 */
export default async function LibraryTabPage({
  params,
  searchParams,
}: {
  params: Promise<{ tab: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { tab } = await params;
  if (!isKnowledgeTabSlug(tab)) notFound();
  const filters = parseHubSearchParams(await searchParams);
  const { organizationId, role, db } = await requirePageMember();

  const [page, assistants, ...navPages] = await Promise.all([
    db.listOrgKnowledgeSources(organizationId, {
      kinds: KNOWLEDGE_TAB_KINDS[tab],
      status: filters.status,
      assistantId: filters.assistant,
      query: filters.q,
      page: filters.page,
      pageSize: HUB_PAGE_SIZE,
    }),
    db.listAssistants(organizationId),
    // One cheap read per tab for the sub-nav counts + health dots.
    ...KNOWLEDGE_TAB_SLUGS.map((slug) =>
      db.listOrgKnowledgeSources(organizationId, {
        kinds: KNOWLEDGE_TAB_KINDS[slug],
        page: 1,
        pageSize: 1,
      })
    ),
  ]);

  return (
    <KnowledgeHubClient
      tab={tab}
      filters={filters}
      items={page.items}
      total={page.total}
      pageSize={HUB_PAGE_SIZE}
      tabSummaries={Object.fromEntries(
        KNOWLEDGE_TAB_SLUGS.map((slug, i) => [
          slug,
          {
            total: navPages[i].total,
            statusCounts: navPages[i].statusCounts,
          },
        ])
      )}
      assistants={assistants.map((a) => ({ id: a.id, title: a.title }))}
      canEdit={canEdit(role)}
    />
  );
}
