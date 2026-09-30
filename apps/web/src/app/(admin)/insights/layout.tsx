import { INSIGHTS_RANGE_SLOT, PortalSlot } from "@/components/shell/slot-portal";
import { InsightsNav } from "@/components/insights/insights-nav";

export default function InsightsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    // Title over the pill rail, as on the Library, above each page's own
    // toolbar. The rail scrolls horizontally when it runs out of room, so one
    // shape serves every width instead of a desktop rail and a phone strip.
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 px-4 pt-3 sm:px-6">
        <InsightsNav />
        {/* The active page's date-range chip lands here; see `SlotPortal`. */}
        <PortalSlot id={INSIGHTS_RANGE_SLOT} className="flex items-center" />
      </header>
      <section className="min-w-0 flex-1 overflow-y-auto">{children}</section>
    </div>
  );
}
