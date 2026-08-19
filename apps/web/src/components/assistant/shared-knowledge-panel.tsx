import Link from "next/link";
import type { OrgKnowledgeSourceListItem } from "@agent-hub/core";
import { Badge } from "@agent-hub/ui";
import { knowledgeTabForKind, sourceTypeLabel } from "@/lib/knowledge-hub";

/**
 * Knowledge this Assistant answers from that lives outside its own
 * collections (PRD #726): Sources owned by the Organization and linked to it
 * from the Library. Read-only here, linking and Direct access are Library
 * decisions, so the per-assistant page still shows the assistant's FULL
 * retrieval reach, which is the link set, not the collection.
 */
export function SharedKnowledgePanel({
  items,
}: {
  items: OrgKnowledgeSourceListItem[];
}) {
  if (items.length === 0) return null;
  return (
    <section className="mt-8">
      <h2 className="text-base font-semibold">Shared knowledge</h2>
      <p className="text-muted-foreground mt-1 text-sm">
        Organization sources linked to this assistant. Manage the links in the
        Library.
      </p>
      <ul className="mt-3 divide-y rounded-lg border">
        {items.map((item) => (
          <li
            key={item.id}
            className="flex items-center justify-between gap-3 px-4 py-3"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{item.name}</p>
              <p className="text-muted-foreground mt-0.5 text-xs">
                {item.conceptCount === 1
                  ? "1 concept"
                  : `${item.conceptCount} concepts`}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Badge variant="outline" className="font-normal">
                {sourceTypeLabel(item.kind)}
              </Badge>
              <Link
                href={`/library/${knowledgeTabForKind(item.kind)}`}
                className="text-muted-foreground hover:text-foreground text-xs underline underline-offset-2"
              >
                Open in Library
              </Link>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
