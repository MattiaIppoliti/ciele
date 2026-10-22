import { createElement } from "react";
import {
  Briefcase,
  Building2,
  Code,
  Component,
  Folder,
  Globe,
  Heart,
  Layers,
  LayoutGrid,
  Megaphone,
  Palette,
  Rocket,
  Smartphone,
  Sparkles,
  Target,
  Zap,
  type LucideIcon,
} from "lucide-react";
import type { ProjectIcon, TaskPriority, TaskStatus, WorkColor } from "@agent-hub/core";
import { TASK_PRIORITY_LABELS, TASK_STATUS_LABELS } from "@agent-hub/core";
import { DOT_CLASS, INK_CLASS, TASK_STATUS_TONE } from "@/lib/work/work-format";
import { cn } from "@/lib/utils";

/**
 * The work section's glyphs (#1054), drawn here rather than traced from the
 * reference: only its idea survives, a status ring that fills as the work
 * moves. Every colour is a tone's ink (DESIGN.md §2.3), so both themes and both
 * palettes recolour them.
 */

/** A point on a circle of radius `r` around (8, 8), `turn` 0 at twelve o'clock. */
function point(r: number, turn: number): [number, number] {
  const angle = turn * Math.PI * 2 - Math.PI / 2;
  return [8 + r * Math.cos(angle), 8 + r * Math.sin(angle)];
}

/** A pie wedge from twelve o'clock, clockwise, covering `fraction` of the disc. */
function wedge(r: number, fraction: number): string {
  if (fraction >= 1) return `M8 ${8 - r}a${r} ${r} 0 1 1 0 ${2 * r}a${r} ${r} 0 1 1 0 ${-2 * r}Z`;
  const [x, y] = point(r, fraction);
  return `M8 8L8 ${8 - r}A${r} ${r} 0 ${fraction > 0.5 ? 1 : 0} 1 ${x.toFixed(3)} ${y.toFixed(3)}Z`;
}

/** How full a status ring is drawn, 0-1. */
const TASK_STATUS_FILL: Record<TaskStatus, number> = {
  backlog: 0,
  to_do: 0,
  in_progress: 0.5,
  in_review: 0.75,
  done: 1,
};

export function TaskStatusIcon({ status, className }: { status: TaskStatus; className?: string }) {
  const fill = TASK_STATUS_FILL[status];
  return (
    <svg
      viewBox="0 0 16 16"
      role="img"
      aria-label={TASK_STATUS_LABELS[status]}
      className={cn("size-4 shrink-0", INK_CLASS[TASK_STATUS_TONE[status]], className)}
      fill="none"
      strokeWidth={1.5}
    >
      {status === "done" ? (
        <>
          <circle cx="8" cy="8" r="6.5" fill="currentColor" stroke="currentColor" />
          <path d="M5.2 8.2l1.9 1.9 3.7-3.9" stroke="var(--background)" strokeLinecap="round" strokeLinejoin="round" />
        </>
      ) : (
        <>
          <circle
            cx="8"
            cy="8"
            r="6"
            stroke="currentColor"
            strokeDasharray={status === "backlog" ? "2 2.2" : undefined}
          />
          {fill > 0 && <path d={wedge(3.4, fill)} fill="currentColor" />}
        </>
      )}
    </svg>
  );
}

const PRIORITY_BARS: Record<TaskPriority, number> = { urgent: 3, high: 3, medium: 2, low: 1, none: 0 };

export function PriorityIcon({ priority, className }: { priority: TaskPriority; className?: string }) {
  const label = TASK_PRIORITY_LABELS[priority];
  if (priority === "urgent") {
    return (
      <svg viewBox="0 0 16 16" role="img" aria-label={label} className={cn("text-tone-red-ink size-4 shrink-0", className)}>
        <rect x="1.5" y="1.5" width="13" height="13" rx="3" fill="currentColor" />
        <path d="M8 4.5v4.5" stroke="var(--background)" strokeWidth="1.8" strokeLinecap="round" />
        <circle cx="8" cy="11.5" r="1" fill="var(--background)" />
      </svg>
    );
  }
  if (priority === "none") {
    return (
      <svg viewBox="0 0 16 16" role="img" aria-label={label} className={cn("text-muted-foreground size-4 shrink-0", className)}>
        {[3, 7, 11].map((x) => (
          <rect key={x} x={x} y="7.25" width="2.5" height="1.5" rx="0.75" fill="currentColor" opacity="0.6" />
        ))}
      </svg>
    );
  }
  const lit = PRIORITY_BARS[priority];
  return (
    <svg viewBox="0 0 16 16" role="img" aria-label={label} className={cn("text-foreground size-4 shrink-0", className)}>
      {[0, 1, 2].map((i) => (
        <rect
          key={i}
          x={2.5 + i * 4}
          y={10 - i * 3.5}
          width="3"
          height={4 + i * 3.5}
          rx="1"
          fill="currentColor"
          opacity={i < lit ? 1 : 0.22}
        />
      ))}
    </svg>
  );
}

const PROJECT_ICONS: Record<ProjectIcon, LucideIcon> = {
  folder: Folder,
  globe: Globe,
  smartphone: Smartphone,
  megaphone: Megaphone,
  rocket: Rocket,
  component: Component,
  building: Building2,
  "layout-grid": LayoutGrid,
  palette: Palette,
  code: Code,
  briefcase: Briefcase,
  target: Target,
  layers: Layers,
  zap: Zap,
  heart: Heart,
  sparkles: Sparkles,
};

export function projectIcon(icon: string): LucideIcon {
  return PROJECT_ICONS[icon as ProjectIcon] ?? Folder;
}

/** A Project's icon in its colour. */
export function ProjectGlyph({
  icon,
  color,
  className,
}: {
  icon: string;
  color: WorkColor;
  className?: string;
}) {
  // A lookup, not a component made here: the icon set is a static table.
  return createElement(projectIcon(icon), {
    "aria-hidden": true,
    className: cn("size-4 shrink-0", INK_CLASS[color], className),
  });
}

/** A solid dot in a work colour, for labels and legends. */
export function ColorDot({ color, className }: { color: WorkColor; className?: string }) {
  return <span aria-hidden className={cn("inline-block size-2 shrink-0 rounded-full", DOT_CLASS[color], className)} />;
}
