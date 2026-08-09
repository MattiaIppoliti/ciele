import type { LucideIcon } from "lucide-react";

/** Placeholder body for Insights sub-sections that aren't built yet. */
export function ComingSoon({
  title,
  description,
  icon: Icon,
}: {
  title: string;
  description: string;
  icon: LucideIcon;
}) {
  return (
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 items-center gap-3 px-4 pt-5 pb-3 sm:px-6">
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
      </header>
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
        <span className="text-primary/40 flex size-24 items-center justify-center rounded-full border-2 border-dashed">
          <Icon className="size-10" />
        </span>
        <h2 className="text-xl font-bold">Coming soon</h2>
        <p className="text-muted-foreground max-w-sm text-sm">{description}</p>
      </div>
    </div>
  );
}
