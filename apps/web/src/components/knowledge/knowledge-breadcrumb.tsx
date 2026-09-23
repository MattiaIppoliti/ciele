import Link from "next/link";
import { ChevronRight } from "lucide-react";

/**
 * The trail above the knowledge drill-down.
 *
 * One component for all three levels, because they were written twice and
 * had already lost a crumb: level 2 read "Knowledge › Sito di Alex" while
 * level 3 read "Sito di Alex › the page", so opening a Document silently
 * dropped the root and the trail stopped saying where in the console you
 * were. A breadcrumb that is assembled per route is a breadcrumb that
 * disagrees with itself.
 *
 * The last crumb is the page you are on, so it is never a link.
 */
export function KnowledgeBreadcrumb({
  crumbs,
}: {
  crumbs: Array<{ label: string; href?: string }>;
}) {
  return (
    <nav
      aria-label="Breadcrumb"
      className="text-muted-foreground mb-3 flex min-w-0 items-center gap-1.5 text-sm"
    >
      {crumbs.map((crumb, index) => {
        const last = index === crumbs.length - 1;
        return (
          <span key={`${crumb.label}-${index}`} className="flex min-w-0 items-center gap-1.5">
            {index > 0 && <ChevronRight className="size-3.5 shrink-0" />}
            {crumb.href && !last ? (
              <Link
                href={crumb.href}
                className="press-text hover:text-foreground shrink-0"
              >
                {crumb.label}
              </Link>
            ) : (
              <span className={last ? "text-foreground truncate" : "shrink-0"}>
                {crumb.label}
              </span>
            )}
          </span>
        );
      })}
    </nav>
  );
}
