import { InsightsNav } from "@/components/insights/insights-nav";

export default function InsightsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    // The same pill rail as the Library, above each page's own header. It
    // scrolls horizontally when it runs out of room, so one shape serves
    // every width instead of a desktop rail and a phone strip.
    <div className="flex h-full min-h-0 flex-col">
      <nav className="shrink-0 px-4 pt-5 sm:px-6">
        <InsightsNav />
      </nav>
      <section className="min-w-0 flex-1 overflow-y-auto">{children}</section>
    </div>
  );
}
