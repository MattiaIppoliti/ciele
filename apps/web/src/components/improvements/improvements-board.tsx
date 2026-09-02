"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useMemo, useState, useTransition } from "react";
import type {
  Improvement,
  ImprovementListItem,
  ImprovementPriority,
  ImprovementStatus,
} from "@agent-hub/core";
import {
  ChevronDown,
  ChevronRight,
  Columns3,
  Download,
  GalleryVerticalEnd,
  ListFilter,
  MessageSquare,
  Search,
} from "lucide-react";
import { Button } from "@agent-hub/ui";
import { listImprovementsPageAction } from "@/app/actions";
import { toast } from "@/lib/toast";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@agent-hub/ui";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatDay } from "@/lib/format";
import { memberDisplayName } from "@/lib/members";
import { UserAvatar } from "@/components/ui/user-avatar";
import { EmptyState } from "@/components/ui/empty-state";
import {
  IMPROVEMENT_PRIORITIES,
  IMPROVEMENT_STATUSES,
  emptyLaneRecord,
  improvementKey,
  improvementKeyClass,
  keepsLinkNavigation,
  laneCountsWithOverrides,
  matchesImprovementFilters,
  mergeImprovementRows,
  priorityMeta,
  recordImprovementUpdate,
  retainPushedOffRows,
  type ImprovementLanePages,
  type ImprovementLaneWindow,
} from "@/lib/improvements";
import { ImprovementContextMenu } from "./improvement-context-menu";
import { useImprovementLanes } from "./use-improvement-lanes";

// Opened only after a click, so it never renders on the server anyway; the
// dynamic import keeps the detail view out of the board's first bundle.
const ImprovementDrawer = dynamic(() =>
  import("./improvement-drawer").then((module) => module.ImprovementDrawer),
);
// Native drag-and-drop reads `dataTransfer` and pointer state the server does
// not have, and the list view is the default, so the Kanban is client-only.
const ImprovementsKanban = dynamic(
  () =>
    import("./improvements-kanban").then((module) => module.ImprovementsKanban),
  { ssr: false },
);

interface MemberOption {
  userId: string;
  email: string;
}

/** Lane list (the original view) or the drag-and-drop Kanban. */
type ViewMode = "list" | "kanban";

/**
 * Per-lane paging state the list and the Kanban both render under a lane:
 * how much of the lane the board holds, how big the lane really is, and the
 * button that fetches the next page of that lane alone.
 */
export interface LanePaging {
  loaded: number;
  total: number;
  hasMore: boolean;
  loading: boolean;
  loadMore: () => void;
}

export function LaneFooter({ paging }: { paging: LanePaging }) {
  if (paging.total === 0) return null;
  return (
    <div className="text-muted-foreground flex items-center justify-between gap-2 px-3 py-2 text-xs">
      <span>
        Showing {Math.min(paging.loaded, paging.total)} of {paging.total}
      </span>
      {paging.hasMore && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          disabled={paging.loading}
          onClick={paging.loadMore}
        >
          {paging.loading ? "Loading…" : "Load more"}
        </Button>
      )}
    </div>
  );
}

export function ImprovementsBoard({
  initialLanes,
  counts,
  members,
  canEdit,
}: {
  /** The first page of every lane, rendered by the server. */
  initialLanes: ImprovementLanePages;
  /** Authoritative lane sizes from the server, refreshed with every mutation. */
  counts: Record<ImprovementStatus, number>;
  members: MemberOption[];
  canEdit: boolean;
}) {
  const [additional, setAdditional] = useState(() =>
    emptyLaneRecord<ImprovementListItem[]>(() => []),
  );
  const [cursors, setCursors] = useState(() =>
    emptyLaneRecord<string | null | undefined>(() => undefined),
  );
  const [loadingLane, setLoadingLane] = useState<ImprovementStatus | null>(
    null,
  );
  // Confirmed mutation results, kept as list items so a row that every loaded
  // page has since dropped (moved onto an unloaded page of another lane) is
  // still rendered from this copy, with the `messageCount` it was last seen with.
  const [updates, setUpdates] = useState<
    Readonly<Record<string, ImprovementListItem>>
  >({});
  const [, startLoadingMore] = useTransition();
  const [exporting, startExporting] = useTransition();

  // Every mutation revalidates this route, so `initialLanes` arrives again.
  // Rows the refreshed first page pushed onto a page nobody has loaded are
  // kept from the previous snapshot (see `retainPushedOffRows`); this is the
  // "information from previous renders" pattern, a setState guarded by a
  // prop comparison, which React re-renders synchronously.
  const [snapshot, setSnapshot] = useState(() => ({
    source: initialLanes,
    retained: emptyLaneRecord<ImprovementListItem[]>(() => []),
  }));
  if (snapshot.source !== initialLanes) {
    const retained = emptyLaneRecord<ImprovementListItem[]>(() => []);
    for (const lane of IMPROVEMENT_STATUSES) {
      retained[lane.value] = retainPushedOffRows(
        [...snapshot.retained[lane.value], ...snapshot.source[lane.value].items],
        initialLanes[lane.value],
        additional[lane.value],
      );
    }
    setSnapshot({ source: initialLanes, retained });
  }

  function cursorOf(status: ImprovementStatus) {
    const loaded = cursors[status];
    return loaded === undefined ? initialLanes[status].nextCursor : loaded;
  }

  const { rows: improvements, deleted } = useMemo(() => {
    const loadedByLane = IMPROVEMENT_STATUSES.map((lane) => [
      ...initialLanes[lane.value].items,
      ...snapshot.retained[lane.value],
      ...additional[lane.value],
    ]);
    // What the merge needs to know per lane to tell "on a page nobody loaded"
    // from "deleted": the smallest seq held and whether the pages are the
    // whole lane.
    const windows = emptyLaneRecord<ImprovementLaneWindow>(() => ({
      floor: Number.POSITIVE_INFINITY,
      exhausted: true,
    }));
    IMPROVEMENT_STATUSES.forEach((lane, index) => {
      const cursor = cursors[lane.value];
      windows[lane.value] = {
        floor: Math.min(...loadedByLane[index].map((row) => row.seq)),
        exhausted:
          (cursor === undefined
            ? initialLanes[lane.value].nextCursor
            : cursor) === null,
      };
    });
    return mergeImprovementRows(loadedByLane, updates, windows);
  }, [initialLanes, snapshot.retained, additional, updates, cursors]);
  // A stored update the merge refused is a row the server deleted; keeping it
  // would seed the ghost again on the next render that changes the windows.
  // Same render-time setState as the snapshot above: the guard empties
  // `deleted` on the re-render, so it runs once.
  if (deleted.length > 0) {
    setUpdates((current) => {
      const next = { ...current };
      for (const id of deleted) delete next[id];
      return next;
    });
  }
  const [search, setSearch] = useState("");
  const [priority, setPriority] = useState<ImprovementPriority | "">("");
  const [assignee, setAssignee] = useState("");
  const [collapsed, setCollapsed] = useState<Set<ImprovementStatus>>(new Set());
  const [view, setView] = useState<ViewMode>("list");
  const [openId, setOpenId] = useState<string | null>(null);
  const recordUpdate = (updated: Improvement) =>
    setUpdates((current) =>
      recordImprovementUpdate(
        current,
        updated,
        improvements.find((row) => row.id === updated.id),
      ),
    );
  const lanes = useImprovementLanes(improvements, canEdit, recordUpdate);
  // The drawer's Delete: every copy the board holds goes at once, so the row
  // does not wait for the merge to work out that the server no longer has it.
  function removeRow(id: string) {
    setUpdates((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
    const without = (rows: ImprovementListItem[]) =>
      rows.filter((row) => row.id !== id);
    setAdditional((current) => {
      const next = { ...current };
      for (const lane of IMPROVEMENT_STATUSES) {
        next[lane.value] = without(next[lane.value]);
      }
      return next;
    });
    setSnapshot((current) => {
      const retained = { ...current.retained };
      for (const lane of IMPROVEMENT_STATUSES) {
        retained[lane.value] = without(retained[lane.value]);
      }
      return { ...current, retained };
    });
    lanes.release(id);
    setOpenId((current) => (current === id ? null : current));
  }

  // Tags the context menu can toggle: the ones in use, plus any removed during
  // this session so taking the last one off does not hide it from the menu.
  const [releasedTags, setReleasedTags] = useState<string[]>([]);
  const tagOptions = useMemo(
    () =>
      [
        ...new Set([...improvements.flatMap((i) => i.tags), ...releasedTags]),
      ].sort(),
    [improvements, releasedTags],
  );
  const rememberTag = (tag: string) =>
    setReleasedTags((prev) => (prev.includes(tag) ? prev : [...prev, tag]));

  const emailOf = (userId: string | null) =>
    userId ? (members.find((m) => m.userId === userId)?.email ?? null) : null;

  const filterActive = Boolean(search.trim() || priority || assignee);
  // Filters run over the rows the board holds, so a lane's filtered count is
  // "matches among loaded rows"; the export applies the same predicate to the
  // whole lane read from the server.
  const filtered = useMemo(
    () =>
      improvements.filter((row) =>
        matchesImprovementFilters(row, { search, priority, assignee }),
      ),
    [improvements, search, priority, assignee],
  );

  const byStatus = useMemo(() => {
    const map = new Map<ImprovementStatus, ImprovementListItem[]>();
    for (const s of IMPROVEMENT_STATUSES) map.set(s.value, []);
    // The lane a card sits in follows the optimistic status, so a drop moves it
    // in the list view too, before the server round trip lands.
    for (const i of filtered) map.get(lanes.statusOf(i))?.push(i);
    return map;
  }, [filtered, lanes]);

  const loadedByLane = useMemo(() => {
    const loaded = emptyLaneRecord(() => 0);
    for (const i of improvements) loaded[lanes.statusOf(i)] += 1;
    return loaded;
  }, [improvements, lanes]);
  const totals = useMemo(
    () => laneCountsWithOverrides(counts, improvements, lanes.statusOf),
    [counts, improvements, lanes],
  );
  const totalCount = IMPROVEMENT_STATUSES.reduce(
    (sum, lane) => sum + totals[lane.value],
    0,
  );

  function loadMore(status: ImprovementStatus) {
    const cursor = cursorOf(status);
    if (!cursor || loadingLane) return;
    setLoadingLane(status);
    startLoadingMore(async () => {
      try {
        const page = await listImprovementsPageAction({ cursor, status });
        setAdditional((current) => ({
          ...current,
          [status]: [...current[status], ...page.items],
        }));
        setCursors((current) => ({ ...current, [status]: page.nextCursor }));
      } catch {
        toast.error("Could not load more improvements");
      } finally {
        setLoadingLane(null);
      }
    });
  }

  function pagingOf(status: ImprovementStatus): LanePaging {
    return {
      loaded: loadedByLane[status],
      total: totals[status],
      hasMore: cursorOf(status) !== null,
      loading: loadingLane === status,
      loadMore: () => loadMore(status),
    };
  }

  function runExport(options: {
    status?: ImprovementStatus;
    format: "csv" | "json";
  }) {
    startExporting(async () => {
      try {
        const { exportImprovements } = await import("./improvements-export");
        const exported = await exportImprovements({
          ...options,
          filters: { search, priority, assignee },
          emailOf,
        });
        toast.success(
          `Exported ${exported} improvement${exported === 1 ? "" : "s"}`,
        );
      } catch {
        toast.error("Could not export improvements");
      }
    });
  }

  function toggle(status: ImprovementStatus) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(status)) next.delete(status);
      else next.add(status);
      return next;
    });
  }

  const exportLabel = (format: "CSV" | "JSON") =>
    filterActive
      ? `Export ${format} (filtered)`
      : `Export ${format} (${totalCount})`;

  return (
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 flex-wrap items-center gap-3 px-4 pt-5 pb-3 sm:px-6">
        <h1
          className="text-2xl font-bold tracking-tight"
          data-testid="improvements-heading"
        >
          Improvements
        </h1>
        {/* Four controls do not fit a phone row beside the title: the search
            field claims its own full-width row and the icon buttons drop their
            labels until `sm`. */}
        <div className="flex w-full items-center gap-2 sm:ml-auto sm:w-auto">
          <div className="relative min-w-0 flex-1 sm:flex-none">
            <Search className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search improvements..."
              className="h-10 w-full rounded-lg pl-9 sm:w-64"
            />
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="outline"
                  aria-label="Filters"
                  className="h-10 shrink-0 rounded-lg px-3 sm:px-4"
                />
              }
            >
              <ListFilter className="size-4" />{" "}
              <span className="hidden sm:inline">Filters</span>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64 p-3">
              <label className="mb-1.5 block text-sm font-medium">
                Priority
              </label>
              <Select
                value={priority}
                onValueChange={(v) =>
                  setPriority(v as ImprovementPriority | "")
                }
              >
                <SelectTrigger className="mb-3">
                  <SelectValue>
                    {(v: string) =>
                      IMPROVEMENT_PRIORITIES.find((p) => p.value === v)
                        ?.label ?? "All priorities"
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">All priorities</SelectItem>
                  {IMPROVEMENT_PRIORITIES.map((p) => (
                    <SelectItem key={p.value} value={p.value}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <label className="mb-1.5 block text-sm font-medium">
                Assignee
              </label>
              <Select
                value={assignee}
                onValueChange={(v) => setAssignee(v as string)}
              >
                <SelectTrigger>
                  <SelectValue>
                    {(v: string) =>
                      v ? memberDisplayName(emailOf(v)) : "Anyone"
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Anyone</SelectItem>
                  {members.map((m) => (
                    <SelectItem key={m.userId} value={m.userId}>
                      {memberDisplayName(m.email)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="outline"
                  aria-label="Export"
                  disabled={exporting}
                  className="h-10 shrink-0 rounded-lg px-3 sm:px-4"
                />
              }
            >
              <Download className="size-4" />{" "}
              <span className="hidden sm:inline">
                {exporting ? "Exporting…" : "Export"}
              </span>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => runExport({ format: "csv" })}>
                {exportLabel("CSV")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => runExport({ format: "json" })}>
                {exportLabel("JSON")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <div className="border-input flex h-10 shrink-0 items-center rounded-lg border p-0.5">
            {(
              [
                { mode: "list", icon: GalleryVerticalEnd, label: "List view" },
                { mode: "kanban", icon: Columns3, label: "Kanban view" },
              ] as const
            ).map(({ mode, icon: Icon, label }) => (
              <button
                key={mode}
                type="button"
                aria-label={label}
                title={label}
                aria-pressed={view === mode}
                onClick={() => setView(mode)}
                className={`flex h-full w-9 items-center justify-center rounded-md transition-colors ${
                  view === mode
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon className="size-4" />
              </button>
            ))}
          </div>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto border-t px-4 py-4 sm:px-6">
        <div className={view === "kanban" ? "" : "mx-auto max-w-5xl space-y-3"}>
          {view === "kanban" && totalCount > 0 && (
            <ImprovementsKanban
              improvements={filtered}
              members={members}
              tagOptions={tagOptions}
              canEdit={canEdit}
              lanes={lanes}
              onOpen={setOpenId}
              onTagRemembered={rememberTag}
              onUpdated={recordUpdate}
              laneCount={(status) =>
                filterActive
                  ? (byStatus.get(status)?.length ?? 0)
                  : totals[status]
              }
              laneFooter={(status) => <LaneFooter paging={pagingOf(status)} />}
            />
          )}

          {view === "list" &&
            IMPROVEMENT_STATUSES.map((lane) => {
              const items = byStatus.get(lane.value) ?? [];
              const isCollapsed = collapsed.has(lane.value);
              const paging = pagingOf(lane.value);
              return (
                <section
                  key={lane.value}
                  {...lanes.laneProps(lane.value)}
                  className={`bg-card overflow-hidden rounded-xl border transition-colors ${
                    lanes.dropLane === lane.value
                      ? "border-primary bg-primary/5"
                      : ""
                  }`}
                >
                  <div className="bg-muted/40 flex items-center gap-2 px-4 py-2.5">
                    <button
                      type="button"
                      onClick={() => toggle(lane.value)}
                      className="text-muted-foreground hover:text-foreground flex items-center gap-2"
                    >
                      {isCollapsed ? (
                        <ChevronRight className="size-4" />
                      ) : (
                        <ChevronDown className="size-4" />
                      )}
                      <span className="text-sm font-semibold">
                        {lane.label}
                      </span>
                      <span className="text-muted-foreground text-xs">
                        {filterActive ? items.length : paging.total}
                      </span>
                    </button>
                    <button
                      type="button"
                      disabled={exporting || paging.total === 0}
                      onClick={() =>
                        runExport({ status: lane.value, format: "csv" })
                      }
                      className="text-primary ml-auto text-xs font-semibold disabled:opacity-40"
                    >
                      Export report
                    </button>
                  </div>

                  {!isCollapsed && (
                    <div className="divide-y">
                      {items.length === 0 && (
                        <p className="text-muted-foreground px-4 py-6 text-center text-sm">
                          {lanes.draggingId
                            ? "Drop an improvement here."
                            : filterActive
                              ? "No loaded improvements match; load more or narrow the search."
                              : "No improvements in this lane."}
                        </p>
                      )}
                      {items.map((i) => {
                        const email = emailOf(i.assigneeId);
                        const pri = priorityMeta(i.priority);
                        const drag = lanes.dragProps(i.id);
                        return (
                          <ImprovementContextMenu
                            key={i.id}
                            item={i}
                            members={members}
                            tagOptions={tagOptions}
                            canEdit={canEdit}
                            onOpenDrawer={() => setOpenId(i.id)}
                            onTagRemembered={rememberTag}
                            onUpdated={recordUpdate}
                          >
                            <Link
                              href={`/improvements/${i.id}`}
                              {...drag}
                              onClick={(e) => {
                                if (keepsLinkNavigation(e)) return;
                                e.preventDefault();
                                setOpenId(i.id);
                              }}
                              className={`hover:bg-muted/40 flex items-center gap-3 px-4 py-3 transition-colors ${
                                lanes.draggingId === i.id ? "opacity-40" : ""
                              } ${
                                drag.draggable
                                  ? "cursor-grab active:cursor-grabbing"
                                  : ""
                              }`}
                            >
                              <span
                                className={`shrink-0 rounded-md border px-1.5 py-0.5 font-mono text-xs ${improvementKeyClass(i.status)}`}
                              >
                                {improvementKey(i.seq)}
                              </span>
                              <span className="min-w-0 flex-1 truncate text-sm font-medium">
                                {i.title}
                              </span>
                              {i.messageCount > 0 && (
                                <span className="text-muted-foreground inline-flex items-center gap-1 text-xs">
                                  <MessageSquare className="size-3.5" />
                                  {i.messageCount}
                                </span>
                              )}
                              <span className="text-muted-foreground hidden text-xs sm:inline">
                                Created {formatDay(i.createdAt)}
                              </span>
                              {i.tags.length > 0 ? (
                                <span className="hidden gap-1 md:flex">
                                  {i.tags.slice(0, 2).map((t) => (
                                    <span
                                      key={t}
                                      className="rounded-full border px-2 py-0.5 text-2xs"
                                    >
                                      {t}
                                    </span>
                                  ))}
                                </span>
                              ) : (
                                <span className="text-muted-foreground hidden text-xs md:inline">
                                  No tags
                                </span>
                              )}
                              {i.priority !== "none" && (
                                <span
                                  className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-2xs font-medium ${pri.chip}`}
                                >
                                  <pri.icon className="size-3" />
                                  {pri.label}
                                </span>
                              )}
                              {email ? (
                                <span title={memberDisplayName(email)}>
                                  <UserAvatar
                                    userId={i.assigneeId}
                                    email={email}
                                    size="size-6"
                                  />
                                </span>
                              ) : (
                                <span className="text-muted-foreground bg-muted flex size-6 shrink-0 items-center justify-center rounded-full text-2xs font-semibold">
                                  N/A
                                </span>
                              )}
                            </Link>
                          </ImprovementContextMenu>
                        );
                      })}
                      <LaneFooter paging={paging} />
                    </div>
                  )}
                </section>
              );
            })}

          {totalCount === 0 && improvements.length === 0 && (
            <EmptyState
              title="No improvements yet"
              description={
                canEdit
                  ? "Open the Inbox, pick an AI answer, and use “Improve Answer” to track a fix here."
                  : "Flagged AI answers will show up here once your team starts tracking them."
              }
            />
          )}
        </div>
      </div>

      {openId && (
        <ImprovementDrawer
          key={openId}
          improvementId={openId}
          members={members}
          canEdit={canEdit}
          onClose={() => setOpenId(null)}
          onUpdated={recordUpdate}
          onDeleted={removeRow}
        />
      )}
    </div>
  );
}
