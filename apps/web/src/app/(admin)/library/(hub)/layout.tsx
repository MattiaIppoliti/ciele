import { RouteSlidingPanel } from "@/components/motion/route-sliding-panel";
import { Suspense, type ReactNode } from "react";
import { Skeleton } from "@agent-hub/ui";
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
export default function LibraryLayout({
  children,
}: {
  children: ReactNode;
}) {
  // Not async, and nothing awaited here: a layout's own awaits sit above this
  // segment's loading.tsx, so the tab skeletons could only appear once the
  // counts were in (the Next docs' "loading.js will not show a fallback" for a
  // layout that reads runtime data). The header streams in its own boundary.
  return (
    <div className="flex h-full flex-col">
      <Suspense fallback={<LibraryHeaderSkeleton />}>
        <LibraryHeaderLoader />
      </Suspense>
      <RouteSlidingPanel className="min-h-0 flex-1 overflow-hidden">{children}</RouteSlidingPanel>
    </div>
  );
}

async function LibraryHeaderLoader() {
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
    <LibraryHeader
      tabSummaries={Object.fromEntries(
        KNOWLEDGE_TAB_SLUGS.map((slug, i) => [
          slug,
          { total: navPages[i].total, statusCounts: navPages[i].statusCounts },
        ])
      )}
      applicationHealthSummary={applicationHealthSummary}
    />
  );
}

/** The title and the tab rail, at LibraryHeader's padding. */
function LibraryHeaderSkeleton() {
  return (
    <div className="shrink-0" aria-hidden>
      <header className="flex flex-wrap items-center gap-3 px-4 pt-5 pb-3 sm:px-6">
        <Skeleton className="h-8 w-28" />
      </header>
      <div className="px-4 sm:px-6">
        <Skeleton className="h-10 w-96 max-w-full rounded-lg" />
      </div>
    </div>
  );
}
