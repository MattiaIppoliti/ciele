import { RouteSlidingPanel } from "@/components/motion/route-sliding-panel";
import { INSIGHTS_RANGE_SLOT, PortalSlot } from "@/components/shell/slot-portal";
import { InsightsNav } from "@/components/insights/insights-nav";
import { requirePageMember } from "@/lib/authz";
import { getEnterpriseCapabilities } from "@agent-hub/agent";

export default async function InsightsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { session, organizationId } = await requirePageMember();
  const showAdmin = await getEnterpriseCapabilities().platformAdmin.canAccess({
    organizationId, userId: session.userId,
  });
  return (
    // Keep the rail and range slot in the same rows across routes, including
    // loading states and Exports, which has no date-range chip.
    <div className="flex h-full min-h-0 flex-col">
      <header className="grid shrink-0 grid-cols-1 items-start gap-3 px-4 py-3 sm:px-6 @4xl:grid-cols-[minmax(0,1fr)_auto]">
        <InsightsNav showAdmin={showAdmin} />
        {/* The active page's date-range chip lands here; see `SlotPortal`. */}
        <PortalSlot id={INSIGHTS_RANGE_SLOT} className="flex h-9 min-w-0 items-start @4xl:justify-end" />
      </header>
      <RouteSlidingPanel className="touch-scroll-clearance min-h-0 min-w-0 flex-1 overflow-y-auto">{children}</RouteSlidingPanel>
    </div>
  );
}
