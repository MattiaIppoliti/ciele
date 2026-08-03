"use client";

import { Link } from "@/components/ui/link";
import { useMemo, useState } from "react";
import type { ImprovementListItem, ImprovementStatus } from "@agent-hub/core";
import {
  ChevronDown,
  ChevronRight,
  Columns3,
  Download,
  GalleryVerticalEnd,
  ListFilter,
  MessageSquare,
  Search,
  WandSparkles,
} from "lucide-react";
import { Button } from "@agent-hub/ui";
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
import { memberDisplayName, memberInitials } from "@/lib/members";
import {
  IMPROVEMENT_PRIORITIES,
  IMPROVEMENT_STATUSES,
  improvementKey,
  keepsLinkNavigation,
  priorityMeta,
} from "@/lib/improvements";
import { ImprovementContextMenu } from "./improvement-context-menu";
import { ImprovementDrawer } from "./improvement-drawer";
import { ImprovementsKanban } from "./improvements-kanban";
import { useImprovementLanes } from "./use-improvement-lanes";

interface MemberOption {
  userId: string;
  email: string;
}

/** Lane list (the original view) or the drag-and-drop Kanban. */
type ViewMode = "list" | "kanban";

function download(
  name: string,
  rows: Record<string, unknown>[],
  format: "csv" | "json",
) {
  let blob: Blob;
  if (format === "json") {
    blob = new Blob([JSON.stringify(rows, null, 2)], {
      type: "application/json",
    });
  } else {
    const headers = Object.keys(rows[0] ?? { id: "" });
    const escape = (v: unknown) => `"${String(v ?? "").replaceAll('"', '""')}"`;
    const csv = [
      headers.join(","),
      ...rows.map((r) => headers.map((h) => escape(r[h])).join(",")),
    ].join("\n");
    blob = new Blob([csv], { type: "text/csv" });
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function ImprovementsBoard({
  improvements,
  members,
  canEdit,
}: {
  improvements: ImprovementListItem[];
  members: MemberOption[];
  canEdit: boolean;
}) {
  const [search, setSearch] = useState("");
  const [priority, setPriority] = useState("");
  const [assignee, setAssignee] = useState("");
  const [collapsed, setCollapsed] = useState<Set<ImprovementStatus>>(new Set());
  const [view, setView] = useState<ViewMode>("list");
  const [openId, setOpenId] = useState<string | null>(null);
  const lanes = useImprovementLanes(improvements, canEdit);

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

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return improvements.filter((i) => {
      if (
        needle &&
        !i.title.toLowerCase().includes(needle) &&
        !improvementKey(i.seq).toLowerCase().includes(needle) &&
        !i.tags.some((t) => t.toLowerCase().includes(needle))
      )
        return false;
      if (priority && i.priority !== priority) return false;
      if (assignee && i.assigneeId !== assignee) return false;
      return true;
    });
  }, [improvements, search, priority, assignee]);

  const byStatus = useMemo(() => {
    const map = new Map<ImprovementStatus, ImprovementListItem[]>();
    for (const s of IMPROVEMENT_STATUSES) map.set(s.value, []);
    // The lane a card sits in follows the optimistic status, so a drop moves it
    // in the list view too, before the server round trip lands.
    for (const i of filtered) map.get(lanes.statusOf(i))?.push(i);
    return map;
  }, [filtered, lanes]);

  function toDownloadRow(i: ImprovementListItem) {
    return {
      key: improvementKey(i.seq),
      title: i.title,
      status: i.status,
      priority: i.priority,
      tags: i.tags.join("; "),
      assignee: emailOf(i.assigneeId) ?? "",
      occurrences: i.messageCount,
      dueDate: i.dueDate ?? "",
      createdAt: i.createdAt,
    };
  }

  function toggle(status: ImprovementStatus) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(status)) next.delete(status);
      else next.add(status);
      return next;
    });
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 flex-wrap items-center gap-3 px-6 pt-5 pb-3">
        <h1 className="text-2xl font-bold tracking-tight">Improvements</h1>
        <div className="ml-auto flex items-center gap-2">
          <div className="relative">
            <Search className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search improvements..."
              className="h-10 w-64 rounded-lg pl-9"
            />
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button variant="outline" className="h-10 rounded-lg px-4" />
              }
            >
              <ListFilter className="size-4" /> Filters
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64 p-3">
              <label className="mb-1.5 block text-sm font-medium">
                Priority
              </label>
              <Select
                value={priority}
                onValueChange={(v) => setPriority(v as string)}
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
                <Button variant="outline" className="h-10 rounded-lg px-4" />
              }
            >
              <Download className="size-4" /> Export
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={() =>
                  download(
                    "improvements.csv",
                    filtered.map(toDownloadRow),
                    "csv",
                  )
                }
              >
                Export CSV ({filtered.length})
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() =>
                  download(
                    "improvements.json",
                    filtered.map(toDownloadRow),
                    "json",
                  )
                }
              >
                Export JSON ({filtered.length})
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <div className="border-input flex h-10 items-center rounded-lg border p-0.5">
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

      <div className="min-h-0 flex-1 overflow-y-auto border-t px-6 py-4">
        <div className={view === "kanban" ? "" : "mx-auto max-w-5xl space-y-3"}>
          {view === "kanban" && improvements.length > 0 && (
            <ImprovementsKanban
              improvements={filtered}
              members={members}
              tagOptions={tagOptions}
              canEdit={canEdit}
              lanes={lanes}
              onOpen={setOpenId}
              onTagRemembered={rememberTag}
            />
          )}

          {view === "list" &&
            IMPROVEMENT_STATUSES.map((lane) => {
              const items = byStatus.get(lane.value) ?? [];
              const isCollapsed = collapsed.has(lane.value);
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
                        {items.length}
                      </span>
                    </button>
                    <button
                      type="button"
                      disabled={items.length === 0}
                      onClick={() =>
                        download(
                          `improvements-${lane.value}.csv`,
                          items.map(toDownloadRow),
                          "csv",
                        )
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
                              <span className="bg-muted/50 shrink-0 rounded-md border px-1.5 py-0.5 font-mono text-xs">
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
                                      className="rounded-full border px-2 py-0.5 text-[11px]"
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
                                  className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${pri.chip}`}
                                >
                                  <pri.icon className="size-3" />
                                  {pri.label}
                                </span>
                              )}
                              {email ? (
                                <span
                                  title={memberDisplayName(email)}
                                  className="bg-primary/10 text-primary flex size-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold"
                                >
                                  {memberInitials(email)}
                                </span>
                              ) : (
                                <span className="text-muted-foreground bg-muted flex size-7 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold">
                                  N/A
                                </span>
                              )}
                            </Link>
                          </ImprovementContextMenu>
                        );
                      })}
                    </div>
                  )}
                </section>
              );
            })}

          {improvements.length === 0 && (
            <div className="flex flex-col items-center gap-3 py-16 text-center">
              <span className="text-primary/40 flex size-20 items-center justify-center rounded-full border-2 border-dashed">
                <WandSparkles className="size-9" />
              </span>
              <h3 className="text-lg font-bold">No improvements yet</h3>
              <p className="text-muted-foreground max-w-sm text-sm">
                {canEdit
                  ? "Open the Inbox, pick an AI answer, and use “Improve Answer” to track a fix here."
                  : "Flagged AI answers will show up here once your team starts tracking them."}
              </p>
            </div>
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
        />
      )}
    </div>
  );
}
