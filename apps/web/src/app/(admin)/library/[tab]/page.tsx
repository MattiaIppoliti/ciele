import { notFound } from "next/navigation";
import { KnowledgeHubClient } from "@/components/knowledge/knowledge-hub-client";
import { requirePageMember } from "@/lib/authz";
import { canEdit, canPublish } from "@/lib/rbac";
import {
  HUB_PAGE_SIZE,
  KNOWLEDGE_TAB_KINDS,
  KNOWLEDGE_TAB_SLUGS,
  isKnowledgeTabSlug,
  parseHubSearchParams,
} from "@/lib/knowledge-hub";
import { applicationOAuthAvailability } from "@/lib/application-oauth";
import { redactApplicationConnection } from "@/lib/application-connections";

export const dynamic = "force-dynamic";

/**
 * The org-level Library (PRD #726): one tab per Source-kind bucket
 * (Websites / Files / Applications / FAQs), every read org-scoped through the Db seam, all
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
  const { organizationId, role, db, session, reads } = await requirePageMember();

  const showApplications = tab === "applications";
  const [
    page,
    assistants,
    applicationConnections,
    applicationImports,
    applicationHealthSummary,
    applicationOperationalRows,
    ...navPages
  ] = await Promise.all([
    db.listOrgKnowledgeSources(organizationId, {
      kinds: KNOWLEDGE_TAB_KINDS[tab],
      status: filters.status,
      assistantId: filters.assistant,
      query: filters.q,
      page: filters.page,
      pageSize: HUB_PAGE_SIZE,
    }),
    reads.assistantShellSummaries(),
    showApplications ? db.listApplicationConnections(organizationId) : Promise.resolve([]),
    showApplications ? db.listApplicationImports(organizationId) : Promise.resolve([]),
    db.getApplicationHealthSummary(organizationId),
    showApplications ? db.listApplicationOperationalState(organizationId) : Promise.resolve([]),
    // Counts only: navigation never hydrates a discarded Source row.
    ...KNOWLEDGE_TAB_SLUGS.map((slug) =>
      db.listOrgKnowledgeSources(organizationId, {
        kinds: KNOWLEDGE_TAB_KINDS[slug],
        page: 1,
        pageSize: 0,
      })
    ),
  ]);
  const applicationOperationalState = applicationOperationalRows.map(
    (state) => [state.importId, state] as const
  );

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
      currentMemberId={session.userId}
      applicationConnections={applicationConnections.map(redactApplicationConnection)}
      applicationImports={applicationImports}
      applicationOperationalState={Object.fromEntries(applicationOperationalState)}
      applicationHealthSummary={applicationHealthSummary}
      canEdit={canEdit(role)}
      canManageConnections={canPublish(role)}
      applicationOAuthAvailability={applicationOAuthAvailability()}
    />
  );
}
