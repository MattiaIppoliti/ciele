import { notFound } from "next/navigation";
import { KnowledgeHubClient } from "@/components/knowledge/knowledge-hub-client";
import { requirePageMember } from "@/lib/authz";
import { can } from "@/lib/rbac";
import {
  KNOWLEDGE_TAB_KINDS,
  isKnowledgeTabSlug,
  parseHubSearchParams,
} from "@/lib/knowledge-hub";
import { applicationOAuthAvailability } from "@/lib/application-oauth";
import { redactApplicationConnection } from "@/lib/application-connections";

export const dynamic = "force-dynamic";

/**
 * One Source-kind bucket of the org-level Library (PRD #726), every read
 * org-scoped through the Db seam, all filtering and pagination server-side via
 * URL search params. The heading, the tab rail and its counts belong to
 * `../layout.tsx`, which outlives this segment.
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
  const { organizationId, role, db, session, reads, capabilities } = await requirePageMember();
  const access = { role, capabilities };

  const showApplications = tab === "applications";
  const [
    page,
    assistants,
    applicationConnections,
    applicationImports,
    applicationOperationalRows,
  ] = await Promise.all([
    // Applications draws no Source table (its Imports open onto their items),
    // so it skips the read rather than fetching a page nobody renders.
    showApplications
      ? Promise.resolve({ items: [], total: 0, qualityAvailable: false })
      : db.listOrgKnowledgeSources(organizationId, {
          kinds: KNOWLEDGE_TAB_KINDS[tab],
          status: filters.status,
          assistantId: filters.assistant,
          query: filters.q,
          page: filters.page,
          pageSize: filters.size,
          sort: filters.sort || undefined,
          ascending: filters.ascending,
          unused: filters.unused,
        }),
    reads.assistantShellSummaries(),
    showApplications ? db.listApplicationConnections(organizationId) : Promise.resolve([]),
    showApplications ? db.listApplicationImports(organizationId) : Promise.resolve([]),
    showApplications ? db.listApplicationOperationalState(organizationId) : Promise.resolve([]),
  ]);
  const applicationOperationalState = applicationOperationalRows.map(
    (state) => [state.importId, state] as const
  );

  return (
    <KnowledgeHubClient
      qualityAvailable={page.qualityAvailable ?? false}
      tab={tab}
      filters={filters}
      items={page.items}
      total={page.total}
      pageSize={filters.size}
      assistants={assistants.map((a) => ({ id: a.id, title: a.title }))}
      currentMemberId={session.userId}
      applicationConnections={applicationConnections.map(redactApplicationConnection)}
      applicationImports={applicationImports}
      applicationOperationalState={Object.fromEntries(applicationOperationalState)}
      canEdit={can(access, "knowledge:edit")}
      canManageConnections={can(access, "applications:connect")}
      applicationOAuthAvailability={applicationOAuthAvailability()}
    />
  );
}
