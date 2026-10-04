// Adapted from user-supplied Beautiful UI source. MIT: see LICENSE.
"use client";

import { useState } from "react";
import {
  filterTableCounts,
  type FilterRow as TableRow,
  type FilterLabels as FilterTableLabels,
} from "@agent-hub/agent/client";
import "./beautiful-tables.css";

/* ─────────────────────────────────────────────────────────
 * FILTER TABLE
 * Status chips directly filter the task table.
 * ───────────────────────────────────────────────────────── */

type Status = "todo" | "progress" | "done";

const FILTERS: { key: "all" | Status; label: string; dot?: string }[] = [
  { key: "all", label: "All" },
  { key: "todo", label: "To do", dot: "#f09a2f" },
  { key: "progress", label: "In Progress", dot: "#16a6c7" },
  { key: "done", label: "Completed", dot: "#25a878" },
];

const PILLS: Record<Status, { label: string; cls: string }> = {
  todo: { label: "To do", cls: "filter-status-todo" },
  progress: { label: "In Progress", cls: "filter-status-progress" },
  done: { label: "Completed", cls: "filter-status-done" },
};

export default function FilterTable({
  rows,
  labels,
}: {
  rows: TableRow[];
  labels: FilterTableLabels;
  variant?: string;
}) {
  const counts = filterTableCounts(rows);
  const [filter, setFilter] = useState<"all" | Status>("all");

  return (
    <div className="beautiful-table w-full max-w-105">
      {/* filter chips */}
      <div
        className="-mx-1 mb-1 flex items-center gap-1 overflow-x-auto px-1 py-1"
        style={{ scrollbarWidth: "none" }}
      >
        {FILTERS.map((f) => {
          const active = filter === f.key;
          return (
            <button
              key={f.key}
              type="button"
              aria-pressed={active}
              onClick={() => setFilter(f.key)}
              className={`flex h-6.5 shrink-0 items-center gap-1.5 rounded-full px-2.5 bui-text-12
                font-medium transition-[background-color,box-shadow,color] duration-200
                ${active ? "bg-surface text-ink shadow-btn" : "text-ink-2 hover:bg-hover"}`}
            >
              {f.dot && (
                <span
                  className="size-1.5 rounded-full"
                  style={{ background: f.dot }}
                />
              )}
              {f.label}
              <span
                className={`rounded-[4px] px-1 bui-text-10-5 tabular-nums
                  ${active ? "bg-field text-ink-2" : "text-ink-3"}`}
              >
                {counts[f.key]}
              </span>
            </button>
          );
        })}
      </div>

      {/* table */}
      <div
        aria-label="Scrollable task table"
        className="overflow-x-auto rounded-card bg-surface shadow-card"
        role="region"
        tabIndex={0}
        style={{ scrollbarWidth: "none" }}
      >
        <div role="table" aria-label="Tasks" className="min-w-[420px]">
          <div
            role="row"
            className="grid grid-cols-[minmax(0,1.3fr)_minmax(0,0.6fr)_minmax(0,0.95fr)_minmax(0,0.9fr)] border-b border-[var(--grid-line)] bui-text-12-5 font-medium text-ink-2"
          >
            <span
              role="columnheader"
              className="border-r border-[var(--grid-line)] px-3 py-2"
            >
              {labels.columns.task}
            </span>
            <span
              role="columnheader"
              className="border-r border-[var(--grid-line)] px-3 py-2"
            >
              {labels.columns.date}
            </span>
            <span
              role="columnheader"
              className="border-r border-[var(--grid-line)] px-3 py-2"
            >
              {labels.columns.status}
            </span>
            <span role="columnheader" className="px-3 py-2">
              {labels.columns.owner}
            </span>
          </div>
          {rows.map((row, index) => {
            const shown = filter === "all" || row.status === filter;
            const pill = PILLS[row.status];
            return (
              <div
                key={index}
                aria-hidden={!shown}
                className="grid transition-[grid-template-rows,opacity] duration-300 motion-reduce:transition-none"
                style={{
                  gridTemplateRows: shown ? "1fr" : "0fr",
                  opacity: shown ? 1 : 0,
                  transitionTimingFunction: "cubic-bezier(0.23, 1, 0.32, 1)",
                }}
              >
                <div className="overflow-hidden">
                  <div
                    role="row"
                    className="grid grid-cols-[minmax(0,1.3fr)_minmax(0,0.6fr)_minmax(0,0.95fr)_minmax(0,0.9fr)] border-b
                      border-[var(--grid-line)] bui-text-13 transition-colors duration-100 hover:bg-hover"
                  >
                    <span
                      role="cell"
                      className="flex min-w-0 items-center border-r border-[var(--grid-line)] px-3 py-2"
                    >
                      <span className="truncate font-medium text-ink">
                        {row.task}
                      </span>
                    </span>
                    <span
                      role="cell"
                      className="flex items-center whitespace-nowrap border-r border-[var(--grid-line)] px-3 py-2 text-ink-2 tabular-nums"
                    >
                      {row.date}
                    </span>
                    <span
                      role="cell"
                      className="flex items-center border-r border-[var(--grid-line)] px-3 py-2"
                    >
                      <span
                        className={`inline-flex h-[23px] shrink-0 items-center whitespace-nowrap rounded-[8px] border px-[7px]
                          bui-text-13 font-medium ${pill.cls}`}
                      >
                        {pill.label}
                      </span>
                    </span>
                    <span
                      role="cell"
                      className="flex min-w-0 items-center px-3 py-2 text-ink-2"
                    >
                      <span className="truncate">{row.owner}</span>
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
          {rows.filter((row) => filter === "all" || row.status === filter)
            .length === 0 && (
            <p role="status" className="p-3 bui-text-13 text-ink-2">
              No records match this filter.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
