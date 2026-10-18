"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { AssistantStatusDay } from "@agent-hub/core";
import { availabilitySummary } from "@agent-hub/core";
import { RollInText } from "@/components/motion/roll-in-text";

const LABELS = {
  up: "Operational",
  degraded: "Degraded",
  down: "Unavailable",
  none: "No recent checks",
};
const COLORS = {
  up: "bg-emerald-500/70",
  degraded: "bg-amber-400",
  down: "bg-red-500",
  none: "bg-muted-foreground/25",
};

/** Daily UTC samples. Unknown days never enter the observed uptime denominator. */
export function StatusBars({
  label,
  days,
  current,
  maxDays = 90,
  loading = false,
}: {
  label: string;
  days: AssistantStatusDay[];
  current?: AssistantStatusDay["status"];
  maxDays?: number;
  loading?: boolean;
}) {
  const root = useRef<HTMLDivElement>(null),
    buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const tooltipId = useId();
  const [width, setWidth] = useState(640),
    [active, setActive] = useState<string | null>(null),
    [focused, setFocused] = useState<string | null>(null);
  useEffect(() => {
    if (!root.current) return;
    const observer = new ResizeObserver(([entry]) =>
      setWidth(entry.contentRect.width),
    );
    observer.observe(root.current);
    return () => observer.disconnect();
  }, []);
  const count = Math.max(
    1,
    Math.min(
      maxDays,
      width >= 90 * 7 ? 90 : width >= 60 * 7 ? 60 : 30,
      Math.floor((width + 4) / 7),
    ),
  );
  const visible = days.slice(-count),
    summary = availabilitySummary(visible);
  const tabDate = visible.some((d) => d.date === focused)
    ? focused
    : visible.at(-1)?.date;
  const lastDay = visible.at(-1);
  const selected = visible.find((d) => d.date === active),
    state = current ?? visible.at(-1)?.status ?? "none";
  const formatDate = (date: string, withYear = false) =>
    new Date(`${date}T12:00:00Z`).toLocaleDateString(undefined, {
      day: "numeric",
      month: "short",
      year: withYear ? "numeric" : undefined,
      timeZone: "UTC",
    });
  const percent = (value: number) =>
    new Intl.NumberFormat(undefined, {
      style: "percent",
      maximumFractionDigits: 2,
      minimumFractionDigits: 2,
    }).format(value);
  const description = (day: AssistantStatusDay) =>
    `${formatDate(day.date, true)} UTC: ${day.checks ? LABELS[day.status] : "No measurements"}. ${day.checks} checks, ${day.failedChecks} failed, ${day.degradedChecks} slow.`;
  return (
    <div
      ref={root}
      className="relative min-w-0 space-y-3"
      onKeyDown={(event) => {
        if (event.key === "Escape") setActive(null);
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setActive(null);
          setFocused(null);
        }
      }}
    >
      <div className="flex items-center justify-between gap-4 text-sm">
        <span className="truncate font-medium">{label}</span>
        <span className="flex shrink-0 items-center gap-2 text-muted-foreground">
          <span className={`size-2 rounded-full ${COLORS[state]}`} />
          {loading ? "Loading…" : LABELS[state]}
        </span>
      </div>
      <div
        className={`relative flex h-12 gap-1 ${loading ? "animate-pulse motion-reduce:animate-none" : ""}`}
        onMouseLeave={() => {
          if (!focused) setActive(null);
        }}
      >
        {(loading
          ? Array.from({ length: 30 }, (_, i) => ({
              date: String(i),
              status: "none" as const,
              checks: 0,
              failedChecks: 0,
              degradedChecks: 0,
              incidents: [],
            }))
          : visible
        ).map((day, index) => (
          <button
            key={day.date}
            type="button"
            ref={(el) => {
              buttons.current[index] = el;
            }}
            disabled={loading}
            tabIndex={day.date === tabDate ? 0 : -1}
            aria-label={loading ? "Loading availability" : description(day)}
            aria-describedby={active === day.date ? tooltipId : undefined}
            className={`min-w-0 flex-1 rounded-sm transition-opacity hover:opacity-80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${COLORS[day.status]}`}
            onMouseEnter={() => setActive(day.date)}
            onFocus={() => {
              setActive(day.date);
              setFocused(day.date);
            }}
            onClick={() => setActive(day.date)}
            onKeyDown={(event) => {
              let next = index;
              if (event.key === "ArrowLeft") next = Math.max(0, index - 1);
              else if (event.key === "ArrowRight")
                next = Math.min(visible.length - 1, index + 1);
              else if (event.key === "Home") next = 0;
              else if (event.key === "End") next = visible.length - 1;
              else return;
              event.preventDefault();
              buttons.current[next]?.focus();
            }}
          />
        ))}
        {selected && !loading && (
          <div
            id={tooltipId}
            role="tooltip"
            className="pointer-events-none absolute bottom-full left-0 z-20 mb-2 max-w-full rounded-xl border bg-popover px-3 py-2 text-xs shadow-strong"
          >
            <p className="font-medium">
              {formatDate(selected.date, true)} · UTC
            </p>
            <p className="mt-1 text-muted-foreground">
              {selected.checks
                ? `${percent(1 - selected.failedChecks / selected.checks)} observed uptime · ${selected.checks} checks`
                : "No measurements for this day"}
            </p>
            {selected.incidents.map((incident, i) => (
              <p key={i} className="mt-1">
                {incident.title} · {incident.checks} checks
              </p>
            ))}
          </div>
        )}
      </div>
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <span>{visible[0] ? formatDate(visible[0].date) : "—"}</span>
        <span className="h-px flex-1 bg-border" />
        <span className="shrink-0 tabular-nums">
          <RollInText
            text={
              summary.uptime === null
                ? "No measurements"
                : `${percent(summary.uptime)} observed uptime`
            }
            entrance={false}
          />
        </span>
        <span className="h-px flex-1 bg-border" />
        <span>
          {lastDay
            ? lastDay.date === new Date().toISOString().slice(0, 10)
              ? "Today"
              : formatDate(lastDay.date)
            : "—"}
        </span>
      </div>
      {!loading && (
        <p className="text-xs text-muted-foreground">
          {summary.checks} checks · {visible.filter((d) => d.checks > 0).length}
          /{visible.length} days sampled
        </p>
      )}
    </div>
  );
}
