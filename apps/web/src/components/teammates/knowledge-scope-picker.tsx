"use client";

import { useMemo, useState } from "react";
import { Input, Label } from "@agent-hub/ui";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/motion/tabs";
import { RollingNumber } from "@/components/motion/rolling-number";
import { sourceTypeLabel } from "@/lib/knowledge-hub";
import {
  SCOPE_TABS,
  SCOPE_TAB_LABELS,
  coveringCollectionName,
  filterByName,
  groupScopeSources,
  knowledgeScopeSummary,
  type ScopeCollection,
  type ScopeSource,
  type ScopeTab,
} from "@/lib/teammates/knowledge-scope";

/**
 * A row off screen skips layout and paint: a Library tab can list hundreds of
 * sources, and this box shows eight. The intrinsic size is one row's height,
 * so the scrollbar stays honest before a row has been drawn.
 */
const COLLECTION_ROW = "[content-visibility:auto] [contain-intrinsic-size:auto_2.25rem]";
const SOURCE_ROW = "[content-visibility:auto] [contain-intrinsic-size:auto_3rem]";

/**
 * The Knowledge Scope picker: what this Teammate may search.
 *
 * Two halves, one control. **Collections** is the whole-bundle answer, and the
 * three Library tabs beside it (Websites / Files / FAQs) are the same buckets
 * `/library` shows, so "let it read the handbook PDF and the refunds FAQ" is a
 * pick rather than a reason to build a Collection nobody wanted.
 *
 * Selecting nothing is a real answer and the summary line says what it means
 * instead of nudging. Selecting an item that a scoped Collection already covers
 * is also allowed, retrieval unions the two halves and deduplicates, but the row
 * says which Collection covers it, because forty redundant ticks are a Member
 * being misled by a checkbox rather than a Member choosing.
 *
 * Every decision here is a pure function in `lib/teammates/knowledge-scope.ts`
 * (vitest does not collect `.tsx`); this component only renders them.
 */
export function KnowledgeScopePicker({
  collections,
  sources,
  sourcesTruncated = false,
  collectionIds,
  sourceIds,
  onCollectionsChange,
  onSourcesChange,
}: {
  collections: ScopeCollection[];
  sources: ScopeSource[];
  sourcesTruncated?: boolean;
  collectionIds: string[];
  sourceIds: string[];
  onCollectionsChange: (next: string[]) => void;
  onSourcesChange: (next: string[]) => void;
}) {
  const [tab, setTab] = useState<ScopeTab>("collections");
  const [query, setQuery] = useState("");
  const grouped = useMemo(() => groupScopeSources(sources), [sources]);

  const toggle = (
    id: string,
    on: boolean,
    selected: string[],
    apply: (next: string[]) => void
  ) => apply(on ? [...selected, id] : selected.filter((x) => x !== id));

  const counts: Record<ScopeTab, number> = {
    collections: collections.length,
    websites: grouped.websites.length,
    files: grouped.files.length,
    applications: grouped.applications.length,
    faqs: grouped.faqs.length,
  };
  const selectedCounts: Record<ScopeTab, number> = {
    collections: collectionIds.length,
    websites: grouped.websites.filter((s) => sourceIds.includes(s.id)).length,
    files: grouped.files.filter((s) => sourceIds.includes(s.id)).length,
    applications: grouped.applications.filter((s) => sourceIds.includes(s.id)).length,
    faqs: grouped.faqs.filter((s) => sourceIds.includes(s.id)).length,
  };

  const visibleCollections = filterByName(collections, query);
  const visibleSources =
    tab === "collections" ? [] : filterByName(grouped[tab], query);

  return (
    <div className="space-y-2">
      <Label>Knowledge</Label>

      {/* One row of tabs rather than one long list: a Library with sixty
          websites in it would bury the Collections a Member usually wants.
          The same pill rail as the Library's own tabs, since these are its
          buckets. */}
      <Tabs
        value={tab}
        // The search box belongs to the tab it filters: carrying a query
        // across would open the next tab looking empty.
        onValueChange={(slug) => {
          setTab(slug as ScopeTab);
          setQuery("");
        }}
      >
        <TabsList aria-label="Knowledge to search">
          {SCOPE_TABS.map((slug) => (
            <TabsTrigger key={slug} value={slug} className="gap-2">
              {SCOPE_TAB_LABELS[slug]}
              <RollingNumber value={counts[slug]} className="text-xs opacity-70" />
              {selectedCounts[slug] > 0 && (
                <span className="bg-primary text-primary-foreground rounded-full px-1.5 text-xs font-semibold">
                  <RollingNumber value={selectedCounts[slug]} />
                  <span className="sr-only"> selected</span>
                </span>
              )}
            </TabsTrigger>
          ))}
        </TabsList>
        {SCOPE_TABS.map((slug) => (
          <TabsContent key={slug} value={slug} className="mt-2 space-y-2">
            {/* Only the open tab renders its rows; the others keep an empty
                panel for their tab to point at. */}
            {slug === tab && (
              <>
                {counts[tab] > 8 && (
                  <Input
                    value={query}
                    onChange={(e) => setQuery(e.target.value.slice(0, 200))}
                    placeholder={`Search ${SCOPE_TAB_LABELS[tab].toLowerCase()}`}
                    aria-label={`Search ${SCOPE_TAB_LABELS[tab].toLowerCase()}`}
                  />
                )}

                <div className="max-h-56 space-y-1 overflow-y-auto rounded-lg border p-2">
                  {tab === "collections" ? (
                    collections.length === 0 ? (
                      <p className="text-muted-foreground px-2 py-1.5 text-sm">
                        No collections yet. Pick websites, files or FAQs, or leave empty.
                      </p>
                    ) : visibleCollections.length === 0 ? (
                      <p className="text-muted-foreground px-2 py-1.5 text-sm">
                        No collection matches that.
                      </p>
                    ) : (
                      visibleCollections.map((collection) => (
                        <label
                          key={collection.id}
                          className={`hover:bg-muted/50 flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm ${COLLECTION_ROW}`}
                        >
                          <Checkbox
                            checked={collectionIds.includes(collection.id)}
                            onCheckedChange={(on) =>
                              toggle(
                                collection.id,
                                on === true,
                                collectionIds,
                                onCollectionsChange
                              )
                            }
                          />
                          {collection.name}
                        </label>
                      ))
                    )
                  ) : counts[tab] === 0 ? (
                    <p className="text-muted-foreground px-2 py-1.5 text-sm">
                      Nothing in your Library&apos;s{" "}
                      {SCOPE_TAB_LABELS[tab].toLowerCase()} yet.
                    </p>
                  ) : visibleSources.length === 0 ? (
                    <p className="text-muted-foreground px-2 py-1.5 text-sm">
                      Nothing matches that.
                    </p>
                  ) : (
                    visibleSources.map((source) => {
                      const covered = coveringCollectionName(
                        source,
                        collectionIds,
                        collections
                      );
                      return (
                        <label
                          key={source.id}
                          className={`hover:bg-muted/50 flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 text-sm ${SOURCE_ROW}`}
                        >
                          <Checkbox
                            className="mt-0.5"
                            checked={sourceIds.includes(source.id)}
                            onCheckedChange={(on) =>
                              toggle(source.id, on === true, sourceIds, onSourcesChange)
                            }
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate">{source.name}</span>
                            <span className="text-muted-foreground block text-xs">
                              {sourceTypeLabel(source.kind)}
                              {covered ? ` · already in scope via ${covered}` : ""}
                            </span>
                          </span>
                        </label>
                      );
                    })
                  )}
                </div>
              </>
            )}
          </TabsContent>
        ))}
      </Tabs>

      <p className="text-muted-foreground text-sm">
        {knowledgeScopeSummary({ collectionIds, sourceIds })}
      </p>
      {sourcesTruncated && (
        <p className="text-muted-foreground text-xs">
          Only recent items are listed. For the rest, pick a collection.
        </p>
      )}
    </div>
  );
}
