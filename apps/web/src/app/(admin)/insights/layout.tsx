import { InsightsNav } from "@/components/insights/insights-nav";

export default function InsightsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-full min-h-0">
      <aside className="w-60 shrink-0 overflow-y-auto border-r px-4 py-6">
        <InsightsNav />
      </aside>
      <section className="min-w-0 flex-1 overflow-y-auto">{children}</section>
    </div>
  );
}
