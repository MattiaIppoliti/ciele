import type { ChatReplyPart } from "@agent-hub/agent/client";
import type { CitationItem } from "@/components/agents/citations";

export type CitationSource = Extract<
  ChatReplyPart,
  { type: "sources" }
>["sources"][number];

/**
 * Concept → Source citations, shaped for the beui citation components.
 *
 * One row per **Concept**, which is the unit a citation resolves to (ADR-0002).
 * Retrieval returns chunks, and several chunks of one Concept are a routine
 * outcome of a good search, so the raw list repeats itself. Two things went
 * wrong with that. A reader saw the same document listed three times, which
 * says the answer rests on three sources when it rests on one; and React saw
 * duplicate keys, because the id is the Concept's, which is what filled the dev
 * overlay with "Encountered two children with the same key".
 *
 * First occurrence wins, so the order retrieval chose survives. The numbering
 * the list draws is positional and nothing in the answer text refers to it, so
 * collapsing rows renumbers nothing a reader was relying on.
 *
 * Shared, rather than a copy per surface, because the widget and the console
 * had one each and both carried the same bug.
 */
export function toCitationItems(
  sources: readonly CitationSource[],
  /** Per-surface link resolution; the widget can offer a file download. */
  resolveUrl?: (source: CitationSource) => string | undefined
): CitationItem[] {
  const seen = new Set<string>();
  const items: CitationItem[] = [];
  for (const [index, source] of sources.entries()) {
    // A citation with no Concept id cannot collide with another by identity,
    // so it gets a positional one rather than being folded into the first.
    const id = source.conceptId ?? `source-${index}`;
    if (seen.has(id)) continue;
    seen.add(id);
    items.push({
      id,
      title: source.conceptTitle,
      domain: source.sourceName
        ? `${source.collectionName} · ${source.sourceName}`
        : source.collectionName,
      url: source.url ?? resolveUrl?.(source),
    });
  }
  return items;
}
