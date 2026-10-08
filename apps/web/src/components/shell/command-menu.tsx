"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import { motion, useReducedMotion } from "motion/react";
import { SPRING_PANEL } from "@/lib/ease";
import { PanelRight, Search, Type, X } from "lucide-react";
import { Button as CieleButton, Dialog, DialogContent, DialogTitle } from "@agent-hub/ui";
import { findStore, useFindSnapshot } from "@/lib/find-client";
import { createPointerAim, WARM_LIMIT } from "@/lib/find-store";
import { FilterChip, FilterMenu } from "@/components/shell/find-filters";
import { PagePreview } from "@/components/shell/find-wireframe";
import { FindRow, KIND_ICONS, type FindItem } from "@/components/shell/find-row";
import {
  EMPTY_FIND_FILTERS,
  FIND_KIND_INFO,
  FIND_KINDS,
  detailRequest,
  FIND_UPDATED_LABELS,
  filterFindRecords,
  opensInNewTab,
  pageContent,
  recencyGroup,
  recentsView,
  NO_PAGE_CONTENT,
  type FindFilters,
  type FindKind,
  type FindUpdated,
} from "@/lib/find-index";
import { fuzzyMatch } from "@/lib/fuzzy";
import {
  GLOBAL_NAV,
  SETUP_SECTIONS,
  assistantIdFromPath,
  setupHref,
  type AssistantSummary,
} from "@/components/shell/nav";
import { canAutoFocus } from "@/lib/auto-focus";

/** Open width of the preview pane, px. Fixed so its content never reflows while it slides. */
const PREVIEW_WIDTH = 392;

/**
 * The row under the pointer is active at once. Only a move heading for the
 * preview across other rows is held, for at most this long, so reaching the
 * preview does not land on a row crossed on the way (`createPointerAim`).
 */
const AIM_HOLD_MS = 140;

/** Rows either side of the active one whose detail is warmed with it. */
const WARM_NEIGHBOURS = 2;

/**
 * "Find…" palette. Type to search across assistants, conversations,
 * improvements, help desks and teammates, plus the console's pages and the
 * scoped SETUP sections. Narrow it by kind and by how recently a thing changed,
 * search titles only, and read a preview of the highlighted result before
 * opening it (Enter opens, Cmd/Ctrl+Enter opens in a new tab).
 *
 * Opened from the sidebar or with F / Cmd+K (see ShellProvider). The active
 * row is a single highlight element that slides between rows as the selection
 * moves. The records come from one server read (`loadFindRecords`) made when
 * the palette opens; everything after is client-side filtering in
 * `lib/find-index.ts`.
 */
export function CommandMenu({
  open,
  onOpenChange,
  assistants,
  scope,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  assistants: AssistantSummary[];
  /** Who the palette answers for: Organization, Member and Role. */
  scope: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const uid = useId();
  const [filters, setFilters] = useState<FindFilters>(EMPTY_FIND_FILTERS);
  const [active, setActive] = useState(0);
  const [showPreview, setShowPreview] = useState(true);
  const listRef = useRef<HTMLDivElement | null>(null);
  const hoverIntent = useMemo(
    () =>
      createPointerAim({
        delayMs: AIM_HOLD_MS,
        // Read at move time. A hidden preview is zero wide, so there is
        // nothing to aim at and every row switches at once.
        target: () => {
          const pane = document.getElementById(`${uid}-preview`)?.getBoundingClientRect();
          return pane && pane.width > 0 ? { left: pane.left, top: pane.top, bottom: pane.bottom } : null;
        },
      }),
    [uid],
  );
  const reduceMotion = useReducedMotion();
  const query = filters.query;

  // The list and the details live in the shared store (`lib/find-store.ts`):
  // kept between openings, shown stale while they refresh, fetched once.
  const { records, recordsStatus, details } = useFindSnapshot();
  // Two different signals. A new `scope` (Organization, Member or Role) means
  // what the store holds belongs to someone else: drop it. A new `assistants`
  // list without one means a mutation refreshed the shell: keep showing what is
  // held, and read again on the next look.
  useEffect(() => {
    findStore.reset();
  }, [scope]);
  useEffect(() => {
    findStore.invalidate();
  }, [assistants]);
  useEffect(() => {
    if (open) findStore.open();
  }, [open, assistants]);

  const scopedId = assistantIdFromPath(pathname);
  const scopedTitle = scopedId
    ? assistants.find((a) => a.id === scopedId)?.title
    : undefined;

  const items = useMemo<FindItem[]>(() => {
    const now = new Date();
    // Sorted newest first, so each recency group is already one run of rows.
    const recordItems: FindItem[] = recentsView(
      filterFindRecords(records ?? [], filters, now),
      filters,
    ).map((record) => ({
      key: record.key,
      label: record.title,
      hint: record.subtitle,
      group: recencyGroup(record.updatedAt, now),
      icon: KIND_ICONS[record.kind],
      href: record.href,
      record,
    }));

    // Pages and SETUP sections have no date and no kind, so they only join in
    // when nothing narrows the search by either.
    const includeStatic = filters.kind === null && filters.updated === "any";
    const q = query.trim();
    const staticItems: FindItem[] = includeStatic
      ? [
          ...GLOBAL_NAV.map((item) => ({
            key: `page:${item.href}`,
            label: item.label,
            hint: "",
            group: "Pages",
            icon: item.icon,
            href: item.href,
            record: null,
          })),
          ...SETUP_SECTIONS.map((section) => ({
            key: `setup:${section.slug}`,
            label: section.label,
            hint: "",
            group: scopedTitle ? `Setup · ${scopedTitle}` : "Setup",
            icon: section.icon,
            href: setupHref(scopedId, section.slug),
            record: null,
          })),
        ].filter((item) => fuzzyMatch(q, item.label))
      : [];

    return [...recordItems, ...staticItems];
  }, [records, filters, query, scopedId, scopedTitle]);

  // The store reads a row's detail as data (`detailRequest`): the active row a
  // beat after it is looked at, and the rows around it and the first screenful
  // ahead of time, in one request, so moving to one of them shows it at once.
  const activeItem = items[active] ?? null;
  const activeRequest = activeItem ? detailRequest(activeItem) : null;
  const activeRequestKey = activeRequest?.key;
  useEffect(() => {
    if (!open || !activeRequest) return;
    findStore.highlight(activeRequest);
    // The request object is rebuilt on every render; its key identifies it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, activeRequestKey]);
  const warmRequests = useMemo(() => {
    const around = items.slice(Math.max(0, active - WARM_NEIGHBOURS), active + WARM_NEIGHBOURS + 1);
    const requests = [...around, ...items.slice(0, WARM_LIMIT)].flatMap((row) => detailRequest(row) ?? []);
    // A key names one request, so keeping the first position and the last copy loses nothing.
    return [...new Map(requests.map((request) => [request.key, request])).values()];
  }, [items, active]);
  useEffect(() => {
    if (open) findStore.warm(warmRequests);
  }, [open, warmRequests]);

  const grouped = useMemo(() => {
    const map = new Map<string, FindItem[]>();
    for (const item of items) {
      const list = map.get(item.group) ?? [];
      list.push(item);
      map.set(item.group, list);
    }
    return Array.from(map.entries());
  }, [items]);

  // Reset the search on close and the selection on every change, done in the
  // handlers (not effects) to avoid cascading renders.
  function handleOpenChange(next: boolean) {
    if (!next) {
      setFilters(EMPTY_FIND_FILTERS);
      setActive(0);
      hoverIntent.cancel();
      findStore.cancelHighlight();
    }
    onOpenChange(next);
  }

  function updateFilters(patch: Partial<FindFilters>) {
    // A switch waiting on a resting pointer must not land on a re-filtered list.
    hoverIntent.cancel();
    setFilters((current) => ({ ...current, ...patch }));
    setActive(0);
  }

  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active]);

  // One highlight element slides between rows (translateY + height transition)
  // instead of each row toggling its own background. It is moved by writing its
  // style directly: routing the measurement through state made every arrow key
  // render the whole palette twice. The callback ref on the list covers first
  // mount (the dialog portal mounts after this component renders, so an effect
  // alone runs too early and finds nothing); the layout effect covers a new
  // selection or a re-filter that moves the row.
  const pillRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef(active);
  const measurePill = useCallback(() => {
    const pill = pillRef.current;
    if (!pill) return;
    const row = listRef.current?.querySelector<HTMLElement>(
      `[data-index="${activeRef.current}"]`,
    );
    if (!row) {
      pill.style.opacity = "0";
      return;
    }
    pill.style.opacity = "1";
    pill.style.height = `${row.offsetHeight}px`;
    pill.style.transform = `translateY(${row.offsetTop}px)`;
  }, []);
  const setListElement = useCallback(
    (el: HTMLDivElement | null) => {
      listRef.current = el;
      if (el) measurePill();
    },
    [measurePill],
  );
  useLayoutEffect(() => {
    activeRef.current = active;
    measurePill();
  }, [active, items, measurePill]);

  function select(item: FindItem, newTab = false) {
    if (newTab) {
      window.open(item.href, "_blank", "noopener,noreferrer");
      return;
    }
    handleOpenChange(false);
    router.push(item.href);
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") hoverIntent.cancel();
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((i) => Math.min(i + 1, items.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const item = items[active];
      if (item) select(item, opensInNewTab(event));
    }
  }

  // Stable handlers for the memoised rows and preview: they read the latest
  // state through refs, so their identity never changes and a move of the
  // selection re-renders the two rows involved instead of the whole list.
  const selectRef = useRef(select);
  const activeItemRef = useRef<FindItem | null>(activeItem);
  useLayoutEffect(() => {
    selectRef.current = select;
    activeItemRef.current = activeItem;
  });
  // The browser fires a mousemove at the pointer's unchanged position when a
  // scroll settles or the row under it changes, and that is not the person
  // moving. Only a move that actually changed the position counts.
  const pointerAt = useRef({ x: -1, y: -1 });
  const onRowMove = useCallback(
    (index: number, x: number, y: number) => {
      if (pointerAt.current.x === x && pointerAt.current.y === y) return;
      pointerAt.current = { x, y };
      hoverIntent.move(index, activeRef.current, x, y, setActive);
    },
    [hoverIntent],
  );
  const onRowSelect = useCallback(
    (item: FindItem, newTab: boolean) => selectRef.current(item, newTab),
    [],
  );
  const onNavigateHref = useCallback((href: string, newTab: boolean) => {
    const current = activeItemRef.current;
    if (current) selectRef.current({ ...current, href }, newTab);
  }, []);
  const onOpenActive = useCallback(() => {
    const current = activeItemRef.current;
    if (current) selectRef.current(current, false);
  }, []);
  const activePage = useMemo(
    () =>
      !activeItem || activeItem.record
        ? NO_PAGE_CONTENT
        : pageContent(activeItem.href, records ?? []),
    [activeItem, records],
  );
  const narrowed =
    filters.titleOnly || filters.kind !== null || filters.updated !== "any";
  const loading = records === null && recordsStatus !== "error";

  let cursor = 0;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        data-modal-layout="search"
        data-modal-motion="instant"
        showCloseButton={false}
        overlayClassName="ui-modal-instant"
        className="find-dialog top-[10vh] flex h-[min(640px,80vh)] translate-y-0 flex-col gap-0 overflow-hidden rounded-2xl p-0 shadow-strong will-change-transform sm:max-w-4xl data-open:duration-300 data-open:ease-[cubic-bezier(0.16,1,0.3,1)] data-open:slide-in-from-top-2 data-closed:duration-100 data-closed:slide-out-to-top-2 motion-reduce:data-open:slide-in-from-top-0 motion-reduce:data-open:zoom-in-100 motion-reduce:data-closed:slide-out-to-top-0 motion-reduce:data-closed:zoom-out-100"
      >
        <DialogTitle className="sr-only">Find</DialogTitle>
        <div className="find-search-header flex shrink-0 items-center gap-2.5 px-4">
          <Search
            aria-hidden
            className="text-muted-foreground size-4 shrink-0"
          />
          <input
            autoFocus={canAutoFocus()}
            data-foley-type=""
            value={query}
            onChange={(e) => updateFilters({ query: e.target.value })}
            onKeyDown={onKeyDown}
            placeholder="Search assistants, conversations, improvements…"
            aria-label="Search assistants, conversations, improvements, help desks, teammates and pages"
            autoComplete="off"
            spellCheck={false}
            role="combobox"
            aria-expanded={open}
            aria-controls={`${uid}-list`}
            aria-activedescendant={
              items.length > 0 ? `${uid}-opt-${active}` : undefined
            }
            aria-autocomplete="list"
            className="placeholder:text-muted-foreground h-12 w-full bg-transparent text-sm outline-none"
          />
          <CieleButton
            variant="ghost"
            size="icon-sm"
            type="button"
            aria-label={showPreview ? "Hide preview" : "Show preview"}
            aria-pressed={showPreview}
            onClick={() => setShowPreview((v) => !v)}
            className={`hidden size-7 shrink-0 items-center justify-center rounded-md transition-colors md:flex ${
              showPreview
                ? "text-foreground bg-muted"
                : "text-muted-foreground hover:bg-muted"
            }`}
          >
            <PanelRight aria-hidden className="size-4" />
          </CieleButton>
          <CieleButton variant="ghost" size="icon" aria-label="Close search" onClick={() => handleOpenChange(false)} className="sm:hidden"><X className="size-5" /></CieleButton>
          <kbd className="text-muted-foreground hidden rounded-md border px-1.5 py-0.5 font-sans text-xs sm:block">
            Esc
          </kbd>
        </div>

        <div className="find-search-filters flex shrink-0 flex-wrap items-center gap-1.5 border-b px-4 pb-3">
          <FilterChip
            pressed={filters.titleOnly}
            onClick={() => updateFilters({ titleOnly: !filters.titleOnly })}
            icon={<Type aria-hidden className="size-3.5" />}
          >
            Title only
          </FilterChip>
          <FilterMenu
            label="Type"
            value={filters.kind ? FIND_KIND_INFO[filters.kind].plural : null}
            options={[
              {
                key: "all",
                label: "Everything",
                selected: filters.kind === null,
              },
              ...FIND_KINDS.map((kind) => ({
                key: kind,
                label: FIND_KIND_INFO[kind].plural,
                selected: filters.kind === kind,
              })),
            ]}
            onSelect={(key) =>
              updateFilters({ kind: key === "all" ? null : (key as FindKind) })
            }
          />
          <FilterMenu
            label="Updated"
            value={
              filters.updated === "any"
                ? null
                : FIND_UPDATED_LABELS[filters.updated]
            }
            options={(Object.keys(FIND_UPDATED_LABELS) as FindUpdated[]).map(
              (updated) => ({
                key: updated,
                label: FIND_UPDATED_LABELS[updated],
                selected: filters.updated === updated,
              }),
            )}
            onSelect={(key) => updateFilters({ updated: key as FindUpdated })}
          />
          {narrowed && (
            <CieleButton
              variant="ghost"
              size="sm"
              type="button"
              onClick={() =>
                updateFilters({ titleOnly: false, kind: null, updated: "any" })
              }
              className="text-muted-foreground hover:text-foreground ml-1 text-xs transition-colors"
            >
              Clear filters
            </CieleButton>
          )}
        </div>

        <div
          className="ui-modal-body flex min-h-0 flex-1 overflow-hidden"
          data-modal-padding="none"
        >
          <div
            ref={setListElement}
            id={`${uid}-list`}
            role="listbox"
            aria-label="Search results"
            data-foley-scroll=""
            onMouseLeave={hoverIntent.leave}
            className="relative min-w-0 flex-1 overflow-y-auto overscroll-contain p-2"
          >
            <div
              ref={pillRef}
              aria-hidden
              className="bg-foreground/[0.08] pointer-events-none absolute inset-x-2 top-0 rounded-lg opacity-0 transition-[transform,height] duration-150 ease-out motion-reduce:transition-none"
            />
            {items.length === 0 && (
              <div
                role="status"
                className="text-muted-foreground px-3 py-8 text-center text-sm break-words"
              >
                {records === null && recordsStatus === "error" ? (
                  <>
                    <p>Couldn’t load results.</p>
                    <CieleButton
                      variant="secondary"
                      size="sm"
                      type="button"
                      onClick={() => findStore.open()}
                      className="text-foreground mt-2 underline underline-offset-4"
                    >
                      Try again
                    </CieleButton>
                  </>
                ) : (
                  <p>
                    {loading
                      ? "Loading…"
                      : query.trim()
                        ? `No results for “${query.trim()}”.`
                        : "Nothing here yet."}
                  </p>
                )}
              </div>
            )}
            {grouped.map(([group, list], groupIndex) => (
              <div
                key={group}
                role="group"
                aria-labelledby={`${uid}-group-${groupIndex}`}
                className="mb-1 last:mb-0"
              >
                <div
                  id={`${uid}-group-${groupIndex}`}
                  className="text-muted-foreground px-2 py-1.5 text-xs font-medium"
                >
                  {group}
                </div>
                {list.map((item) => {
                  const index = cursor++;
                  return (
                    <FindRow
                      key={item.key}
                      item={item}
                      index={index}
                      isActive={index === active}
                      optionId={`${uid}-opt-${index}`}
                      onMove={onRowMove}
                      onSelect={onRowSelect}
                    />
                  );
                })}
              </div>
            ))}
          </div>

          {/* Always mounted so it can slide: the width springs open and shut
              on the sidebar's own spring, and the content inside keeps its
              width so it is clipped, never reflowed, along the way. */}
          <motion.aside
            id={`${uid}-preview`}
            aria-label="Preview"
            inert={!showPreview}
            initial={false}
            animate={{
              width: showPreview ? PREVIEW_WIDTH : 0,
              opacity: showPreview ? 1 : 0,
            }}
            transition={reduceMotion ? { duration: 0 } : SPRING_PANEL}
            className="hidden shrink-0 overflow-hidden md:block"
          >
            <div
              className="h-full overflow-y-auto border-l p-4"
              style={{ width: PREVIEW_WIDTH }}
            >
              {activeItem ? (
                <PagePreview
                  item={activeItem}
                  detail={details.get(activeRequestKey ?? "")}
                  page={activePage}
                  onNavigateHref={onNavigateHref}
                  onOpen={onOpenActive}
                />
              ) : (
                null
              )}
            </div>
          </motion.aside>
        </div>

        <div className="ui-modal-footer text-muted-foreground flex shrink-0 items-center gap-4 text-xs">
          <span className="hidden items-center gap-1.5 sm:flex">
            <kbd className="rounded border px-1 font-sans">↵</kbd> Open
          </span>
          <span className="hidden items-center gap-1.5 sm:flex">
            <kbd className="rounded border px-1 font-sans">⌘ ↵</kbd> Open in new
            tab
          </span>
          {records !== null &&
            (recordsStatus === "partial" || recordsStatus === "error") && (
              <CieleButton
                variant="secondary"
                size="sm"
                wrap
                type="button"
                onClick={() => findStore.open()}
                className="hover:text-foreground underline underline-offset-4"
              >
                Some results could not be loaded. Try again
              </CieleButton>
            )}
          <span role="status" className="ml-auto tabular-nums">
            {items.length} {items.length === 1 ? "result" : "results"}
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
