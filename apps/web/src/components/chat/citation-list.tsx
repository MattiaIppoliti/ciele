import { ChevronRight, ExternalLink } from "lucide-react";

/**
 * The Sources citation list rendered under a grounded AI answer. RAG
 * citations always resolve to a Concept → Source (ADR-0002), never opaque
 * chunks — this component is the single place that shape is displayed, shared
 * by the widget, the admin Preview, and the Inbox transcript. Interactivity
 * and theming differ per surface, but the citation chip does not.
 *
 * When a citation carries the concept's original page URL (OKF `resource`),
 * the chip is a link that opens the page in a new tab; the full title is the
 * hover tooltip (the chip itself truncates).
 *
 * `collapsible` hides the chips behind a disclosure, which is how the Inbox
 * transcript shows them (#561): a reviewer scanning a long conversation wants the
 * turns, and opens the provenance for the turn they are questioning. In the chat
 * itself the citations are the point of a grounded answer, so they stay visible.
 * A native `<details>` keeps it keyboard- and screen-reader-operable for free.
 */

export interface Citation {
  conceptTitle: string;
  collectionName: string;
  sourceName: string | null;
  url?: string | null;
}

export function CitationList({
  sources,
  className,
  collapsible = false,
}: {
  sources: Citation[];
  className?: string;
  collapsible?: boolean;
}) {
  const chips = (
    <div className="flex flex-col gap-1.5">
      {sources.map((s, i) => {
          const tooltip =
            s.conceptTitle +
            (s.collectionName || s.sourceName
              ? `, ${[s.collectionName, s.sourceName].filter(Boolean).join(" · ")}`
              : "");
          const inner = (
            <>
              <span className="truncate">{s.conceptTitle}</span>
              <ExternalLink className="text-muted-foreground size-3 shrink-0" />
            </>
          );
          return s.url ? (
            <a
              key={i}
              href={s.url}
              target="_blank"
              rel="noopener noreferrer"
              title={tooltip}
              className="text-foreground/80 inline-flex w-fit max-w-full items-center gap-1.5 truncate rounded-md border bg-muted/60 px-2.5 py-1 text-xs transition-colors hover:border-muted-foreground/40 hover:bg-muted"
            >
              {inner}
            </a>
          ) : (
            <span
              key={i}
              title={tooltip}
              className="text-foreground/80 inline-flex w-fit max-w-full items-center gap-1.5 truncate rounded-md border px-2.5 py-1 text-xs"
            >
              {inner}
            </span>
          );
        })}
    </div>
  );

  const label = `Sources${sources.length > 1 ? ` (${sources.length})` : ""}`;

  if (collapsible) {
    return (
      <details className={`group ${className ?? ""}`}>
        <summary className="text-muted-foreground hover:text-foreground inline-flex w-fit cursor-pointer list-none items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold transition-colors">
          <ChevronRight className="size-3 transition-transform group-open:rotate-90" />
          {label}
        </summary>
        <div className="mt-1.5">{chips}</div>
      </details>
    );
  }

  return (
    <div className={className}>
      <p className="text-muted-foreground mb-1.5 text-[11px] font-semibold">
        <span className="rounded-full border px-2 py-0.5">{label}</span>
      </p>
      {chips}
    </div>
  );
}
