import type { SourceKind } from "@agent-hub/core";
import {
  KNOWLEDGE_TAB_KINDS,
  KNOWLEDGE_TAB_SLUGS,
  knowledgeTabForKind,
  type KnowledgeTabSlug,
} from "@/lib/knowledge-hub";

/**
 * Pure derivations for a Teammate's **Knowledge Scope**: whole Library
 * Collections, plus the individual Library items (websites, files, FAQs) it may
 * search alongside them.
 *
 * Here rather than in the picker component for the usual reason: vitest only
 * collects `.ts`, so the grouping, the redundancy rule and every sentence a
 * Member reads about their scope are testable only if they are not JSX. The
 * component renders these; it decides nothing.
 */

export interface ScopeCollection {
  id: string;
  name: string;
}

/** One selectable Library item, as the picker and the roster card need it. */
export interface ScopeSource {
  id: string;
  name: string;
  kind: SourceKind;
  /** The Collection it sits in, which is what makes a pick redundant. */
  collectionId: string;
}

/** The picker's tabs: the three Library buckets, plus Collections first. */
export type ScopeTab = "collections" | KnowledgeTabSlug;

export const SCOPE_TABS: ScopeTab[] = ["collections", ...KNOWLEDGE_TAB_SLUGS];

export const SCOPE_TAB_LABELS: Record<ScopeTab, string> = {
  collections: "Collections",
  websites: "Websites",
  files: "Files",
  applications: "Applications",
  faqs: "FAQs",
};

/**
 * The Library items, bucketed the way the Library itself buckets them, so the
 * picker's tabs and `/library` cannot disagree about where a file lives.
 */
export function groupScopeSources(
  sources: readonly ScopeSource[]
): Record<KnowledgeTabSlug, ScopeSource[]> {
  const groups = Object.fromEntries(
    KNOWLEDGE_TAB_SLUGS.map((slug) => [slug, [] as ScopeSource[]])
  ) as Record<KnowledgeTabSlug, ScopeSource[]>;
  for (const source of sources) {
    groups[knowledgeTabForKind(source.kind)].push(source);
  }
  return groups;
}

/** Whether a Library item's kind belongs on a given tab. */
export function scopeSourceOnTab(
  source: ScopeSource,
  tab: KnowledgeTabSlug
): boolean {
  return KNOWLEDGE_TAB_KINDS[tab].includes(source.kind);
}

/** Case-insensitive name filter, the picker's search box. */
export function filterByName<T extends { name: string }>(
  items: readonly T[],
  query: string
): T[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...items];
  return items.filter((item) => item.name.toLowerCase().includes(needle));
}

/**
 * The Collection that already covers a Library item, if a scoped one does.
 *
 * Picking an item that sits inside a Collection already in scope is harmless,
 * retrieval unions the two halves and deduplicates, but it is also pointless,
 * and a picker that stays silent about it invites a Member to tick forty files
 * they already had. Naming the Collection is the useful half of saying so.
 */
export function coveringCollectionName(
  source: ScopeSource,
  collectionIds: readonly string[],
  collections: readonly ScopeCollection[]
): string | null {
  if (!collectionIds.includes(source.collectionId)) return null;
  return (
    collections.find((collection) => collection.id === source.collectionId)
      ?.name ?? "a collection in scope"
  );
}

const plural = (count: number, one: string, many: string) =>
  `${count} ${count === 1 ? one : many}`;

/**
 * What the scope does, in one sentence, for the picker's helper text.
 *
 * An empty scope gets its own sentence rather than "searches 0 collections":
 * it is a configuration a Member chose (a copywriter, a rubber duck), and the
 * runtime registers no search tool at all for it (`teammateSearchesKnowledge`),
 * so the copy has to say what that means instead of reading as a count of
 * nothing.
 */
export function knowledgeScopeSummary(scope: {
  collectionIds: readonly string[];
  sourceIds: readonly string[];
}): string {
  const parts: string[] = [];
  if (scope.collectionIds.length > 0) {
    parts.push(plural(scope.collectionIds.length, "collection", "collections"));
  }
  if (scope.sourceIds.length > 0) {
    parts.push(plural(scope.sourceIds.length, "library item", "library items"));
  }
  if (parts.length === 0) {
    return "Nothing selected: it answers from its role and says so when a question needs a source.";
  }
  return `Searches ${parts.join(" and ")}, and cites what it finds.`;
}

/**
 * The roster card's one line about what a Teammate knows.
 *
 * Names, not counts, because the card is where a Member recognises the Teammate
 * they meant. Deleted entries are still named as deleted: an id in a scope with
 * no row behind it is exactly the state the dangling-scope Alert exists for
 * (#769), and silently dropping it from this line would hide it.
 */
export function knowledgeScopeLabel(
  scope: { collectionIds: readonly string[]; sourceIds: readonly string[] },
  known: {
    collections: readonly ScopeCollection[];
    sources: readonly ScopeSource[];
  }
): string {
  const names = [
    ...scope.collectionIds.map(
      (id) =>
        known.collections.find((collection) => collection.id === id)?.name ??
        "a deleted collection"
    ),
    ...scope.sourceIds.map(
      (id) =>
        known.sources.find((source) => source.id === id)?.name ??
        "a deleted library item"
    ),
  ];
  if (names.length === 0) {
    return "Answers from its persona only, no knowledge in scope";
  }
  return `Knows: ${names.join(", ")}`;
}
