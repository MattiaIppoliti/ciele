"use client";

import { useState, type ReactNode } from "react";
import { ArrowDownUp, Check, ListFilter, Rows3, Search, Star, X } from "lucide-react";
import { Input, Popover, PopoverClose, PopoverContent, PopoverTrigger } from "@agent-hub/ui";
import type { WorkFilter, WorkFilterField, WorkGroupField, WorkSortField, WorkViewQuery } from "@agent-hub/core";
import {
  DUE_FILTER_VALUES,
  RECENCY_FILTER_VALUES,
  TASK_PRIORITIES,
  TASK_PRIORITY_LABELS,
  TASK_STATUSES,
  TASK_STATUS_LABELS,
  STARRED,
  UNASSIGNED,
} from "@agent-hub/core";
import { cn } from "@/lib/utils";
import { PillButton, WorkBar } from "./work-ui";
import { groupTitle } from "@/lib/work/work-format";
import { useWorkDirectory } from "./work-directory";

/**
 * The view toolbar (#1050): text, filters (is / is not, values OR'd inside a
 * filter, filters AND'd), sort and group. The query is the view engine's from
 * core, so what this edits is exactly what the URL and a Saved View store.
 */

const FIELD_LABELS: Record<WorkFilterField, string> = {
  status: "Status",
  assignee: "Assignee",
  priority: "Priority",
  label: "Label",
  project: "Project",
  due: "Due date",
  created: "Created",
  updated: "Updated",
  starred: "Starred",
};

const SORT_LABELS: Record<WorkSortField, string> = {
  manual: "Manual",
  title: "Title",
  due: "Due date",
  start: "Start date",
  priority: "Priority",
  status: "Status",
  assignee: "Assignee",
  created: "Created",
  updated: "Updated",
  estimate: "Estimate",
  project: "Project",
};

const GROUP_LABELS: Record<WorkGroupField, string> = {
  status: "Status",
  priority: "Priority",
  assignee: "Assignee",
  project: "Project",
  due: "Due date",
  none: "No grouping",
};

const RECENCY_LABELS: Record<string, string> = { "1": "Last 24 hours", "7": "Last 7 days", "30": "Last 30 days" };

function useFieldOptions(): (field: WorkFilterField) => { value: string; label: string }[] {
  const dir = useWorkDirectory();
  return (field) => {
    switch (field) {
      case "status":
        return TASK_STATUSES.map((value) => ({ value, label: TASK_STATUS_LABELS[value] }));
      case "priority":
        return TASK_PRIORITIES.map((value) => ({ value, label: TASK_PRIORITY_LABELS[value] }));
      case "assignee":
        return [
          { value: UNASSIGNED, label: "Unassigned" },
          ...dir.people.filter((p) => p.assignable).map((p) => ({ value: p.userId, label: p.name })),
        ];
      case "label":
        return dir.labels.map((l) => ({ value: l.id, label: l.name }));
      case "project":
        return dir.projects.map((p) => ({ value: p.id, label: p.name }));
      case "due":
        return DUE_FILTER_VALUES.map((value) => ({
          value,
          label: groupTitle("due", value, { person: () => "", project: () => "" }),
        }));
      case "created":
      case "updated":
        return RECENCY_FILTER_VALUES.map((value) => ({ value, label: RECENCY_LABELS[value]! }));
      case "starred":
        return [{ value: STARRED, label: "Starred" }];
    }
  };
}

/** My Tasks' one-click filter for the Tasks you starred (#1050): `starred:is:yes`, toggled. */
export function StarredChip({ query, onChange }: { query: WorkViewQuery; onChange: (next: WorkViewQuery) => void }) {
  const on = query.filters.some((filter) => filter.field === "starred");
  const filters: WorkFilter[] = on
    ? query.filters.filter((filter) => filter.field !== "starred")
    : [...query.filters, { field: "starred", op: "is", values: [STARRED] }];
  return (
    <PillButton className={cn(BAR_BUTTON, on && "bg-alpha-light text-foreground")} aria-pressed={on} onClick={() => onChange({ ...query, filters })}>
      <Star aria-hidden className={cn("size-3.5", on && "fill-current")} /> Starred
    </PillButton>
  );
}

const ROW =
  "hover:bg-alpha-light flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none focus-visible:bg-alpha-light";

/** A toolbar control: a small ghost button, its label in the muted ink until hovered or open. */
export const BAR_BUTTON =
  "text-muted-foreground hover:text-foreground data-[popup-open]:bg-alpha-light data-[popup-open]:text-foreground h-7 px-2 text-xs font-medium";

export function WorkToolbar({
  query,
  onChange,
  fields,
  sorts,
  groups,
  showGroup = true,
  showSort = true,
  extra,
  right,
}: {
  query: WorkViewQuery;
  onChange: (next: WorkViewQuery) => void;
  /** Filter fields this scope offers (a Project page has no Project filter). */
  fields: readonly WorkFilterField[];
  sorts: readonly WorkSortField[];
  groups: readonly WorkGroupField[];
  showGroup?: boolean;
  /** Calendar and Timeline place Tasks by date, so a sort means nothing there. */
  showSort?: boolean;
  /** After Sort and Group: Columns, a layout switch, Save view. */
  extra?: ReactNode;
  /** Pushed to the right end: the view's New task. */
  right?: ReactNode;
}) {
  const options = useFieldOptions();
  const setFilters = (filters: WorkFilter[]) => onChange({ ...query, filters });

  return (
    <div className="flex flex-col">
      <WorkBar>
        <div className="relative mr-1 w-full max-w-56 @md:w-36">
          <Search aria-hidden className="text-muted-foreground absolute top-1/2 left-2 size-3.5 -translate-y-1/2" />
          <Input
            value={query.text}
            onChange={(event) => onChange({ ...query, text: event.target.value })}
            placeholder="Search tasks"
            aria-label="Search tasks"
            className="h-7 pl-7 text-xs md:text-xs"
          />
        </div>
        <FilterBuilder query={query} fields={fields} options={options} onChange={setFilters} />
        {showSort && (
        <Popover>
          <PopoverTrigger render={<PillButton className={BAR_BUTTON} />}>
            <ArrowDownUp className="size-3.5" />
            <span className="hidden @5xl:inline">Sort:</span> {SORT_LABELS[query.sort.field]}
          </PopoverTrigger>
          <PopoverContent align="start" className="w-52 p-1">
            {sorts.map((field) => (
              <PopoverClose
                key={field}
                render={<button type="button" />}
                className={ROW}
                aria-pressed={query.sort.field === field}
                onClick={() =>
                  onChange({
                    ...query,
                    sort: {
                      field,
                      direction: query.sort.field === field && query.sort.direction === "asc" ? "desc" : "asc",
                    },
                  })
                }
              >
                {SORT_LABELS[field]}
                {query.sort.field === field && (
                  <span className="text-muted-foreground ml-auto text-xs">
                    {query.sort.direction === "asc" ? "Ascending" : "Descending"}
                  </span>
                )}
              </PopoverClose>
            ))}
          </PopoverContent>
        </Popover>
        )}
        {showGroup && (
          <Popover>
            <PopoverTrigger render={<PillButton className={BAR_BUTTON} />}>
              <Rows3 className="size-3.5" />
              <span className="hidden @5xl:inline">Group:</span> {query.group === "none" ? "None" : GROUP_LABELS[query.group]}
            </PopoverTrigger>
            <PopoverContent align="start" className="w-48 p-1">
              {groups.map((group) => (
                <PopoverClose
                  key={group}
                  render={<button type="button" />}
                  className={ROW}
                  aria-pressed={query.group === group}
                  onClick={() => onChange({ ...query, group })}
                >
                  {GROUP_LABELS[group]}
                  {query.group === group && <Check aria-hidden className="ml-auto size-4" />}
                </PopoverClose>
              ))}
            </PopoverContent>
          </Popover>
        )}
        {extra}
        <span className="flex-1" />
        {right}
      </WorkBar>
      {query.filters.length > 0 && (
        <div className="border-alpha-medium flex flex-wrap items-center gap-1.5 border-b px-6 py-2" aria-label="Active filters">
          {query.filters.map((filter, index) => {
            const labels = new Map(options(filter.field).map((o) => [o.value, o.label]));
            return (
              <span
                key={`${filter.field}-${index}`}
                className="bg-tone-blue text-tone-blue-ink inline-flex h-6 max-w-full items-center gap-1 rounded-md pr-0.5 pl-2 text-xs"
              >
                <span className="opacity-80">{FIELD_LABELS[filter.field]}</span>
                <span>{filter.op === "is" ? "is" : "is not"}</span>
                <span className="truncate font-medium">
                  {filter.values.map((v) => labels.get(v) ?? v).join(", ")}
                </span>
                <button
                  type="button"
                  className="press-control hover:bg-alpha-light rounded p-0.5"
                  aria-label={`Remove ${FIELD_LABELS[filter.field]} filter`}
                  onClick={() => setFilters(query.filters.filter((_, i) => i !== index))}
                >
                  <X className="size-3.5" />
                </button>
              </span>
            );
          })}
          <PillButton className={BAR_BUTTON} onClick={() => setFilters([])}>
            Clear all
          </PillButton>
        </div>
      )}
    </div>
  );
}

function FilterBuilder({
  query,
  fields,
  options,
  onChange,
}: {
  query: WorkViewQuery;
  fields: readonly WorkFilterField[];
  options: (field: WorkFilterField) => { value: string; label: string }[];
  onChange: (filters: WorkFilter[]) => void;
}) {
  const [field, setField] = useState<WorkFilterField | null>(null);
  const current = field ? query.filters.find((f) => f.field === field) : undefined;
  const values = current?.values ?? [];
  const op = current?.op ?? "is";

  const write = (next: Partial<WorkFilter>) => {
    if (!field) return;
    const merged: WorkFilter = { field, op, values, ...next };
    const others = query.filters.filter((f) => f.field !== field);
    onChange(merged.values.length ? [...others, merged] : others);
  };

  return (
    <Popover onOpenChange={(open) => !open && setField(null)}>
      <PopoverTrigger render={<PillButton className={cn(BAR_BUTTON, query.filters.length > 0 && "text-foreground")} />}>
        <ListFilter className="size-3.5" /> Filter
        {query.filters.length > 0 && (
          <span className="bg-tone-blue text-tone-blue-ink rounded px-1 text-2xs">{query.filters.length}</span>
        )}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-1">
        {!field ? (
          fields.map((f) => (
            <button key={f} type="button" className={ROW} onClick={() => setField(f)}>
              {FIELD_LABELS[f]}
              {query.filters.some((x) => x.field === f) && <Check aria-hidden className="ml-auto size-4" />}
            </button>
          ))
        ) : (
          <div>
            <div className="flex items-center gap-1 px-1 pb-1">
              <button type="button" className="press-text text-muted-foreground text-xs" onClick={() => setField(null)}>
                ← {FIELD_LABELS[field]}
              </button>
              <div className="ml-auto flex rounded-md" role="radiogroup" aria-label="Operator">
                {(["is", "not"] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={op === value}
                    className={cn(
                      "press-control rounded-md px-2 py-0.5 text-xs",
                      op === value ? "bg-alpha-strong font-medium" : "text-muted-foreground"
                    )}
                    onClick={() => write({ op: value })}
                  >
                    {value === "is" ? "is" : "is not"}
                  </button>
                ))}
              </div>
            </div>
            <div className="max-h-64 overflow-y-auto" role="group" aria-label={FIELD_LABELS[field]}>
              {options(field).map((option) => {
                const on = values.includes(option.value);
                return (
                  <button
                    key={option.value}
                    type="button"
                    className={ROW}
                    aria-pressed={on}
                    onClick={() =>
                      write({ values: on ? values.filter((v) => v !== option.value) : [...values, option.value] })
                    }
                  >
                    <span className="min-w-0 truncate">{option.label}</span>
                    {on && <Check aria-hidden className="ml-auto size-4" />}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
