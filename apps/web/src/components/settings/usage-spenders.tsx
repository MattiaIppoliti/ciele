import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@agent-hub/ui";
import { formatCredits } from "@/lib/usage-summary";
import type { SpenderSectionView } from "@/lib/usage-spenders-view";

/**
 * "Where the credits went" (#848): who spent the window's credits.
 *
 * A thin renderer. Every number, label, share and fold comes from
 * `usage-spenders-view.ts`, which is where the tests are.
 *
 * One card per dimension that names somebody, so an organization with no
 * Routines is never shown an empty Routines card. Each card totals its own
 * dimension and nothing else: a Teammate turn names the Teammate *and* the
 * Member who asked, so the same credit legitimately appears on two cards and
 * adding them together would be wrong.
 */
export function UsageSpendersBlock({
  sections,
}: {
  sections: SpenderSectionView[];
}) {
  if (sections.length === 0) return null;
  return (
    <section className="mt-6">
      <h2 className="text-sm font-medium">Where the credits went</h2>
      <p className="text-muted-foreground mt-1 text-sm">
        Who used this window&apos;s credits. A Teammate answer counts for both the Teammate and the colleague, so don&apos;t add the cards up.
      </p>
      <div className="mt-3 grid gap-4 sm:grid-cols-2">
        {sections.map((section) => (
          <Card key={section.dimension}>
            <CardHeader>
              <CardTitle>{section.title}</CardTitle>
              <CardDescription>
                {formatCredits(section.credits)} credits
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {section.entries.map((entry, index) => (
                <div key={`${entry.id ?? "unattributed"}-${index}`}>
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="truncate">{entry.label}</span>
                    <span className="tabular-nums shrink-0">
                      {formatCredits(entry.credits)}
                    </span>
                  </div>
                  <div
                    className="bg-muted mt-1 h-1.5 overflow-hidden rounded-full"
                    aria-hidden
                  >
                    <div
                      className="bg-foreground/60 h-full rounded-full"
                      style={{ width: `${Math.round(entry.fraction * 100)}%` }}
                    />
                  </div>
                  <p className="text-muted-foreground mt-1 text-xs">
                    {entry.calls.toLocaleString("en-US")} calls
                    {entry.ownCredits > 0
                      ? ` · ${formatCredits(entry.ownCredits)} on your own credentials`
                      : null}
                  </p>
                </div>
              ))}
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}
