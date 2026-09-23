import type { ReactNode } from "react";
import { LibraryHeader } from "@/components/knowledge/library-header";
import { requirePageMember } from "@/lib/authz";
import { KNOWLEDGE_TAB_KINDS, KNOWLEDGE_TAB_SLUGS } from "@/lib/knowledge-hub";

export const dynamic = "force-dynamic";

/**
 * The Library's shell. The heading and the tab rail live here rather than in
 * `[tab]/page.tsx` because Next keys each route segment: rendered inside the
 * page, the rail's indicator unmounted on every tab click and the pill jumped
 * instead of gliding. A layout outlives the segment below it.
 *
 * It therefore also owns the per-tab counts the rail shows, which is one read
 * per bucket with `pageSize: 0`, so navigation never hydrates a row it will
 * not draw.
 */
export default async function LibraryLayout({
  children,
}: {
  children: ReactNode;
}) {
  const { organizationId, db } = await requirePageMember();
  const [applicationHealthSummary, ...navPages] = await Promise.all([
    db.getApplicationHealthSummary(organizationId),
    ...KNOWLEDGE_TAB_SLUGS.map((slug) =>
      db.listOrgKnowledgeSources(organizationId, {
        kinds: KNOWLEDGE_TAB_KINDS[slug],
        page: 1,
        pageSize: 0,
      })
    ),
  ]);

  return (
    <div className="flex h-full flex-col">
      <LibraryHeader
        tabSummaries={Object.fromEntries(
          KNOWLEDGE_TAB_SLUGS.map((slug, i) => [
            slug,
            { total: navPages[i].total, statusCounts: navPages[i].statusCounts },
          ])
        )}
        applicationHealthSummary={applicationHealthSummary}
      />
      {children}
    </div>
  );
}
