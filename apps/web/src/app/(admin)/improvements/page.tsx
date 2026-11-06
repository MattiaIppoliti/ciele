import Link from "next/link";
import { isImprovementWorkflowUnavailable } from "@agent-hub/db";
import { IMPROVEMENT_STATUS_VALUES } from "@agent-hub/core";
import { ImprovementsBoard } from "@/components/improvements/improvements-board";
import { requirePageMember } from "@/lib/authz";
import {
  IMPROVEMENT_LANE_PAGE_SIZE,
  improvementQueryFromUrl,
  improvementsUrlStateFromSearchParams,
  type ImprovementLanePages,
} from "@/lib/improvements";
import { can } from "@/lib/rbac";

export const dynamic = "force-dynamic";

/**
 * The board is correct and bounded at once: every lane gets the newest page
 * of its own rows plus the server's count of the whole lane, and pages the
 * rest on its own cursor. A single newest-N window over the tracker looked
 * the same on a small org and silently dropped an old In-Progress item once
 * the Done lane outgrew it.
 */
export default async function ImprovementsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { organizationId, role, db, session, capabilities } = await requirePageMember();
  const access = { role, capabilities };
  const urlState = improvementsUrlStateFromSearchParams(await searchParams);

  const filters = improvementQueryFromUrl(urlState);
  const data = await Promise.all([
    db.countImprovementsByStatus(organizationId, filters),
    db.listMembers(organizationId),
    db.table("projects").list({ organizationId }),
    db.listAssistants(organizationId),
    ...IMPROVEMENT_STATUS_VALUES.map((status) =>
      db.listImprovementsPage(organizationId, {
        ...filters,
        limit: IMPROVEMENT_LANE_PAGE_SIZE,
        status,
      }),
    ),
  ]).catch((error: unknown) => {
    // A filtered read reaches `query_improvements`; until its migration lands,
    // say so rather than show unfiltered rows under a filter.
    if (isImprovementWorkflowUnavailable(error)) return null;
    throw error;
  });
  if (!data) {
    return (
      <div className="space-y-3 p-6">
        <h1 className="text-2xl font-semibold">Improvements</h1>
        <p>Filtered views are unavailable until the database upgrade completes.</p>
        <Link href="/improvements" className="press-text underline">
          Open all improvements
        </Link>
      </div>
    );
  }
  const [counts, members, projects, assistants, ...pages] = data;
  const initialLanes = Object.fromEntries(
    IMPROVEMENT_STATUS_VALUES.map((status, index) => [status, pages[index]]),
  ) as ImprovementLanePages;

  return (
    <ImprovementsBoard
      initialLanes={initialLanes}
      counts={counts}
      assistants={assistants.map(({ id, title }) => ({ id, title }))}
      currentMemberId={session.userId}
      projects={projects.map(({ id, name }) => ({ id, name }))}
      members={members.map((m) => ({ userId: m.userId, email: m.email }))}
      canEdit={can(access, "improvements:edit")}
      initialUrlState={urlState}
    />
  );
}
