import { InsightsNav } from "@/components/insights/insights-nav";

export default function InsightsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    // A 240px rail next to the charts is a desktop shape. Below `lg` the same
    // four destinations become a scrollable tab strip above the content, so the
    // report keeps the full width it needs to stay readable.
    <div className="flex h-full min-h-0 flex-col lg:flex-row">
      <aside className="shrink-0 border-b px-3 py-2 lg:w-60 lg:overflow-y-auto lg:border-r lg:border-b-0 lg:px-4 lg:py-6">
        <InsightsNav />
      </aside>
      <section className="min-w-0 flex-1 overflow-y-auto">{children}</section>
    </div>
  );
}
