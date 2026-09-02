import { IMPROVEMENT_STATUS_VALUES } from "@agent-hub/core";
import { ImprovementsBoard } from "@/components/improvements/improvements-board";
import { requirePageMember } from "@/lib/authz";
import {
  IMPROVEMENT_LANE_PAGE_SIZE,
  type ImprovementLanePages,
} from "@/lib/improvements";
import { canEdit } from "@/lib/rbac";

export const dynamic = "force-dynamic";

/**
 * The board is correct and bounded at once: every lane gets the newest page
 * of its own rows plus the server's count of the whole lane, and pages the
 * rest on its own cursor. A single newest-N window over the tracker looked
 * the same on a small org and silently dropped an old In-Progress item once
 * the Done lane outgrew it.
 */
export default async function ImprovementsPage() {
  const { organizationId, role, db } = await requirePageMember();

  const [counts, members, ...pages] = await Promise.all([
    db.countImprovementsByStatus(organizationId),
    db.listMembers(organizationId),
    ...IMPROVEMENT_STATUS_VALUES.map((status) =>
      db.listImprovementsPage(organizationId, {
        limit: IMPROVEMENT_LANE_PAGE_SIZE,
        status,
      }),
    ),
  ]);
  const initialLanes = Object.fromEntries(
    IMPROVEMENT_STATUS_VALUES.map((status, index) => [status, pages[index]]),
  ) as ImprovementLanePages;

  return (
    <ImprovementsBoard
      initialLanes={initialLanes}
      counts={counts}
      members={members.map((m) => ({ userId: m.userId, email: m.email }))}
      canEdit={canEdit(role)}
    />
  );
}
