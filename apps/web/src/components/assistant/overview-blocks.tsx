"use client";

import Link from "next/link";
import type { UsageDashboard } from "@agent-hub/core";
import { Activity, ShieldCheck, ArrowUpRight, Circle, CircleCheck, ClipboardCheck } from "lucide-react";
import { ArcFrame } from "@/components/charts/arc/arc-frame";
import { Gauge } from "@/components/charts/arc/gauge/gauge";
import { Tooltip } from "@/components/charts/beui/motion/tooltip";
import { RollInText } from "@/components/motion/roll-in-text";
import { RollingNumber } from "@/components/motion/rolling-number";
import { AnimatedIcon } from "@/components/ui/animated-icon";
import { DashboardStatCards } from "@/components/insights/dashboard/dashboard-stat-cards";
import { EmptyState } from "@/components/ui/empty-state";
import { activityStats } from "@/lib/insights/dashboard-stats";
import { formatEur } from "@/lib/insights/dashboard-view";
import { pointsDelta, qualityRows, type QualityRow } from "@/lib/assistant-overview";
import { formatCount } from "@/lib/format";

function ChecklistRow({
  done,
  label,
  href,
}: {
  done: boolean;
  label: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      className={`press hover:bg-muted flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors focus-visible:ring-ring/50 outline-none focus-visible:ring-2 ${
        done ? "text-muted-foreground line-through decoration-1" : ""
      }`}
    >
      {done ? (
        <AnimatedIcon
          icon={CircleCheck}
          size={16}
          iconClassName="text-emerald-600"
          className="shrink-0"
        />
      ) : (
        <Circle className="text-muted-foreground size-4 shrink-0" />
      )}
      {label}
    </Link>
  );
}

/** Content sits in a dark inset; the caption and destination share the outer frame. */
export function OverviewCard({
  title,
  icon,
  meta,
  href,
  hrefLabel,
  children,
  actions,
  heading = "h2",
  className = "",
}: {
  title: string;
  icon: React.ReactNode;
  meta?: React.ReactNode;
  href?: string;
  hrefLabel?: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
  heading?: "h1" | "h2";
  className?: string;
}) {
  const Heading = heading;
  return (
    <section
      data-slot="overview-card"
      className={`overview-card flex min-w-0 flex-col ${className}`}
    >
      <div
        data-slot="overview-card-content"
        className="overview-card-content min-w-0 flex-1 p-2"
      >
        {children}
      </div>
      <footer
        data-slot="overview-card-caption"
        className="overview-card-caption flex flex-wrap items-center justify-between gap-3 px-3 py-3"
      >
        <div className="flex min-w-0 flex-1 basis-36 items-center gap-3">
          <span
            data-slot="overview-card-icon"
            className="overview-card-icon flex size-9 shrink-0 items-center justify-center rounded-full"
            aria-hidden
          >
            {icon}
          </span>
          <div className="min-w-0">
            <Heading className="text-sm font-medium">{title}</Heading>
            {meta && <div className="text-muted-foreground text-xs">{meta}</div>}
          </div>
        </div>
        {actions}
        {href && (
          <Link
            href={href}
            aria-label={`${title}: ${hrefLabel || "Open"}`}
            className="overview-card-link press-text text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 flex shrink-0 items-center gap-1.5 rounded-sm text-xs font-medium outline-none focus-visible:ring-2"
          >
            {hrefLabel}
            <ArrowUpRight className="overview-card-arrow size-4" aria-hidden />
          </Link>
        )}
      </footer>
    </section>
  );
}

/**
 * One row of the Quality card: a small ring and the share it stands for. It
 * answers a hover or a keyboard focus with what the share is made of, the
 * counts behind it and the same share the week before, so a ring is never
 * just a percentage with nothing under it.
 */
export function OverviewQualityRow({ row }: { row: QualityRow }) {
  const delta = pointsDelta(row.rate, row.previousRate);
  const rateText = row.rate === null ? row.empty : `${(row.rate * 100).toFixed(1)}%`;
  const content =
    row.rate === null ? (
      <span className="text-muted-foreground">{row.empty} in the last 7 days.</span>
    ) : (
      <span className="grid gap-1">
        <span className="font-medium">{row.label}</span>
        <span>
          <RollInText text={formatCount(row.good)} /> {row.goodLabel} · <RollInText text={formatCount(row.bad)} /> {row.badLabel}
        </span>
        <span className="text-muted-foreground">
          {row.previousRate === null
            ? "No earlier week to compare"
            : `Prior 7 days: ${(row.previousRate * 100).toFixed(1)}% (${delta})`}
        </span>
      </span>
    );
  return (
    <Tooltip content={content} delay={60} wrapperClassName="flex w-full" className="max-w-72 text-xs">
      <div
        tabIndex={0}
        aria-label={`${row.label}: ${rateText}`}
        className="group hover:bg-muted focus-visible:ring-ring/50 flex w-full cursor-default items-center gap-3 rounded-lg px-3 py-2 outline-none transition-colors focus-visible:ring-2"
      >
        {row.rate === null ? (
          <span className="border-muted-foreground/30 size-6 shrink-0 rounded-full border-2 border-dashed" aria-hidden="true" />
        ) : (
          <span className="shrink-0 transition-transform duration-200 group-hover:scale-110 group-focus-visible:scale-110 motion-reduce:transition-none motion-reduce:group-hover:scale-100">
            <ArcFrame>
              <Gauge compact value={row.rate * 100} label={row.label} tone="success" />
            </ArcFrame>
          </span>
        )}
        <span className="min-w-0 flex-1 truncate text-sm">{row.label}</span>
        <span className="text-muted-foreground group-hover:text-foreground text-sm tabular-nums transition-colors">
          {rateText}
        </span>
      </div>
    </Tooltip>
  );
}

export interface OverviewChecklistStep {
  label: string;
  section: string;
  href: string;
  done: boolean;
}

/** The caption leads to the first unfinished step; a completed checklist disappears. */
export function OverviewChecklist({ steps }: { steps: readonly OverviewChecklistStep[] }) {
  const doneCount = steps.filter((step) => step.done).length;
  const nextStep = steps.find((step) => !step.done);
  if (!nextStep) return null;
  return (
    <OverviewCard title="Setup checklist" icon={<ClipboardCheck className="size-4" />}
      meta={<span className="tabular-nums"><RollingNumber value={doneCount} />/{steps.length}</span>}
      href={nextStep.href} hrefLabel={nextStep.section}>
      {steps.map((step) => <ChecklistRow key={step.label} {...step} />)}
    </OverviewCard>
  );
}

/** One complete Activity block, shared with the Assistant Overview. */
export function OverviewActivity({ activity, previousActivity, href, periodLabel = "7 days", deltaLabel = "vs prior 7 days", loading = false }: {
  activity: UsageDashboard;
  previousActivity: UsageDashboard["totals"] | null;
  href: string;
  periodLabel?: string;
  loading?: boolean;
  deltaLabel?: string;
}) {
  return <OverviewCard title="Activity" icon={<Activity className="size-4" />} meta={periodLabel} href={href} hrefLabel="Observability">
    {activity.totals.turns === 0 && !loading
      ? <EmptyState size="sm" title="No recent activity" description="No turns in the selected range. Try the Assistant in the Preview." />
      : <DashboardStatCards specs={activityStats(activity, previousActivity)} columns={1} bare loading={loading} deltaLabel={deltaLabel} />}
  </OverviewCard>;
}

/** Quality rings, supporting counts and estimated spend in one card. */
export function OverviewQuality({ totals, previous, href, costsHref, periodLabel = "7 days" }: {
  totals: UsageDashboard["totals"];
  previous: UsageDashboard["totals"] | null;
  href: string;
  costsHref: string;
  periodLabel?: string;
}) {
  return <OverviewCard title="Quality" icon={<ShieldCheck className="size-4" />} meta={periodLabel} href={href} hrefLabel="Details">
    {qualityRows(totals, previous).map((row) => <OverviewQualityRow key={row.key} row={row} />)}
    <Link href={costsHref} className="press hover:bg-muted mt-1 flex items-center justify-between gap-3 rounded-lg border-t px-3 py-2.5 text-sm">
      <span className="text-muted-foreground">Estimated spend</span>
      <span className="font-medium tabular-nums"><RollInText text={formatEur(totals.spendEur)} /></span>
    </Link>
  </OverviewCard>;
}
