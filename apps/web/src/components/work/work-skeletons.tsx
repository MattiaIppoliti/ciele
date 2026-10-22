import type { ReactNode } from "react";
import { Skeleton } from "@agent-hub/ui";
import { cn } from "@/lib/utils";

/**
 * Loading shapes for the work routes (#1063), mirroring their pages so nothing
 * moves when the page streams in: the page's header (a Project's, with its
 * view tabs, or a task page's title), the ruled toolbar, then the layout's own
 * body. List and Table are ruled rows edge to edge, Board its sunken columns,
 * Calendar the month grid, Timeline the pinned task column beside the bars,
 * Files a grid of cards.
 */

export type WorkSkeletonLayout = "list" | "board" | "calendar" | "timeline" | "files";

function Busy({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <div className={cn("flex h-full min-h-0 flex-col", className)} role="status" aria-busy="true">
      <span className="sr-only">Loading {label}…</span>
      {children}
    </div>
  );
}

/** A task page's title, and My Tasks' summary line under it. */
function PageHeader({ summary }: { summary: boolean }) {
  return (
    <div className="flex shrink-0 flex-col gap-1.5 px-6 pt-5 pb-3">
      <Skeleton className="h-7 w-36" />
      {summary && <Skeleton className="h-4 w-72" />}
    </div>
  );
}

/** A Project's header and its view tabs. */
function ProjectHeader() {
  return (
    <>
      <div className="flex shrink-0 items-center gap-2.5 px-6 pt-5 pb-3">
        <Skeleton className="size-7 rounded-lg" />
        <Skeleton className="h-6 w-44" />
        <Skeleton className="h-6 w-20 rounded-full" />
        <Skeleton className="ml-auto h-7 w-24" />
      </div>
      <div className="border-alpha-medium flex h-9 shrink-0 items-center gap-5 overflow-hidden border-b px-6">
        {[64, 36, 46, 44, 64, 64, 40, 56].map((width, i) => (
          <Skeleton key={i} className="h-3.5 shrink-0" style={{ width }} />
        ))}
      </div>
    </>
  );
}

function Toolbar() {
  return (
    <div className="border-alpha-medium flex min-h-11 shrink-0 items-center gap-1.5 border-b px-6 py-2">
      <Skeleton className="h-7 w-52" />
      <Skeleton className="h-7 w-16" />
      <Skeleton className="h-7 w-20" />
      <Skeleton className="ml-auto h-7 w-24" />
    </div>
  );
}

function RowsBody() {
  return (
    <div className="min-h-0 flex-1 overflow-hidden">
      {[4, 3].map((count, group) => (
        <div key={group}>
          <div className="border-alpha-medium flex h-9 items-center gap-2 border-b px-6">
            <Skeleton className="size-3.5 rounded-full" />
            <Skeleton className="h-3.5 w-24" />
          </div>
          {Array.from({ length: count }).map((_, i) => (
            <div key={i} className="border-alpha-medium flex h-9 items-center gap-3 border-b px-6">
              <Skeleton className="size-3.5 rounded-full" />
              <Skeleton className="h-3 w-12" />
              <Skeleton className="h-3.5 flex-1" />
              <Skeleton className="size-5 rounded-full" />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function BoardBody() {
  return (
    <div className="flex min-h-0 flex-1 items-start gap-3 overflow-hidden px-6 pt-3.5 pb-6">
      {[3, 2, 4, 1, 2].map((cards, i) => (
        <div key={i} className="bg-alpha-lighter border-alpha-medium flex w-71 shrink-0 flex-col rounded-xl border">
          <div className="flex h-10 items-center gap-1.75 pt-1 pr-2 pl-3">
            <Skeleton className="size-3.5 rounded-full" />
            <Skeleton className="h-3.5 w-20" />
          </div>
          <div className="flex flex-col gap-1.5 px-2 pt-1 pb-2">
            {Array.from({ length: cards }).map((_, j) => (
              <div key={j} className="bg-content border-alpha-medium flex flex-col gap-2 rounded-lg border px-3 py-2.5">
                <Skeleton className="h-3.5 w-full" />
                <Skeleton className="h-3.5 w-2/3" />
                <div className="flex items-center gap-2">
                  <Skeleton className="h-3 w-12" />
                  <Skeleton className="ml-auto size-5 rounded-full" />
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** The month the Calendar opens on: five ruled weeks, a chip here and there. */
function CalendarBody() {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="border-alpha-medium flex min-h-11 shrink-0 items-center gap-2 border-b px-6 py-2">
        <Skeleton className="h-7 w-14" />
        <Skeleton className="size-7" />
        <Skeleton className="size-7" />
        <Skeleton className="mx-1 h-5 w-32" />
        <Skeleton className="ml-auto h-7 w-28" />
      </div>
      <div className="border-alpha-medium grid shrink-0 grid-cols-7 border-b">
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="px-2.5 py-2">
            <Skeleton className="h-3 w-7" />
          </div>
        ))}
      </div>
      <div className="grid flex-1 grid-cols-7" style={{ gridTemplateRows: "repeat(5, minmax(112px, 1fr))" }}>
        {Array.from({ length: 35 }).map((_, i) => (
          <div key={i} className={cn("border-alpha-medium flex min-w-0 flex-col gap-0.75 border-r border-b p-1.5", i % 7 === 6 && "border-r-0")}>
            <Skeleton className="size-5.5 rounded-full" />
            {Array.from({ length: i % 5 === 1 ? 2 : i % 3 === 0 ? 1 : 0 }).map((_, j) => (
              <Skeleton key={j} className="h-5.5 w-full rounded-sm" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// The Timeline's own pixel measures (task-timeline.tsx): its column, header, rows and bars.
const LEFT = 300;
const HEAD = 52;
const ROW = 36;
const BAR = 24;
const BARS = [
  { left: 64, width: 192 },
  { left: 160, width: 96 },
  { left: 224, width: 288 },
  { left: 96, width: 128 },
  { left: 352, width: 160 },
  { left: 288, width: 64 },
  { left: 416, width: 224 },
];

function TimelineBody() {
  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      <div className="border-alpha-medium shrink-0 border-r" style={{ width: LEFT }}>
        <div className="border-alpha-medium flex items-end border-b pb-2 pl-6" style={{ height: HEAD }}>
          <Skeleton className="h-3 w-10" />
        </div>
        {BARS.map((_, i) => (
          <div key={i} className="border-alpha-medium flex items-center gap-2 border-b pr-3 pl-6" style={{ height: ROW }}>
            <Skeleton className="size-3.5 rounded-full" />
            <Skeleton className="h-3.5 flex-1" />
            <Skeleton className="h-3 w-10" />
          </div>
        ))}
      </div>
      <div className="min-w-0 flex-1">
        <div className="border-alpha-medium flex flex-col border-b" style={{ height: HEAD }}>
          <div className="flex flex-1 items-center px-2">
            <Skeleton className="h-3 w-16" />
          </div>
          <div className="border-alpha-medium flex-1 border-t" />
        </div>
        {BARS.map((bar, i) => (
          <div key={i} className="border-alpha-medium relative border-b" style={{ height: ROW }}>
            <Skeleton className="absolute" style={{ left: bar.left, width: bar.width, top: (ROW - BAR) / 2, height: BAR }} />
          </div>
        ))}
      </div>
    </div>
  );
}

function FilesBody() {
  return (
    <div className="min-h-0 flex-1 overflow-hidden px-6 pt-3.5 pb-8">
      <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="border-alpha-medium overflow-hidden rounded-xl border">
            <Skeleton className="aspect-[16/10] w-full rounded-none" />
            <div className="flex flex-col gap-1.5 px-2.5 py-2.25">
              <Skeleton className="h-3.5 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const BODY: Record<WorkSkeletonLayout, () => ReactNode> = {
  list: RowsBody,
  board: BoardBody,
  calendar: CalendarBody,
  timeline: TimelineBody,
  files: FilesBody,
};

/** The layout a Project view slug draws; Table's rows read as List's, and the rest fall back to them. */
function layoutOf(view: string | undefined): WorkSkeletonLayout {
  return view === "board" || view === "calendar" || view === "timeline" || view === "files" ? view : "list";
}

/**
 * The view a Project URL is heading to, `/projects/{id}/{view}`, for a
 * boundary that stands in for more than its own page. A Saved View's tab
 * (`/projects/{id}/views/{viewId}`) names no layout, so it draws rows.
 */
export function projectViewFromPath(pathname: string | null): string | undefined {
  const view = (pathname ?? "").split("/")[3];
  return view === "views" ? undefined : view;
}

/** A Project's page: its header and view tabs, then the view's own shape. */
export function ProjectViewSkeleton({ view }: { view?: string }) {
  const Body = BODY[layoutOf(view)];
  return (
    <Busy label="project">
      <ProjectHeader />
      <Toolbar />
      <Body />
    </Busy>
  );
}

/** All tasks and My Tasks: the title, the toolbar, then the layout's shape. */
export function TaskListSkeleton({
  label,
  layout = "list",
  summary = false,
}: {
  label: string;
  layout?: WorkSkeletonLayout;
  /** My Tasks' counts under the title. */
  summary?: boolean;
}) {
  const Body = BODY[layout];
  return (
    <Busy label={label}>
      <PageHeader summary={summary} />
      <Toolbar />
      <Body />
    </Busy>
  );
}

export function TaskPageSkeleton() {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-4 py-6 @md:px-8" role="status" aria-busy="true">
      <span className="sr-only">Loading task…</span>
      <div className="flex items-center gap-2">
        <Skeleton className="h-6 w-32 rounded-full" />
        <Skeleton className="h-4 w-14" />
        <Skeleton className="ml-auto h-8 w-32" />
      </div>
      <Skeleton className="h-9 w-2/3" />
      <div className="grid gap-x-6 gap-y-2 @lg:grid-cols-2 @3xl:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-full" />
        ))}
      </div>
      <Skeleton className="h-28 w-full" />
    </div>
  );
}

/** The Notifications page: the list (title, tabs, rows) beside an empty preview. */
export function NotificationsSkeleton() {
  return (
    <div className="@container grid h-full grid-cols-1 @3xl:grid-cols-[minmax(0,420px)_minmax(0,1fr)]" role="status" aria-busy="true">
      <span className="sr-only">Loading notifications…</span>
      <div className="border-alpha-medium flex flex-col gap-3 pt-5 @3xl:border-r">
        <div className="flex items-center gap-2 px-6">
          <Skeleton className="size-5 rounded-sm" />
          <Skeleton className="h-7 w-40" />
          <Skeleton className="ml-auto h-6 w-28" />
        </div>
        <div className="flex gap-4 px-6">
          {[40, 64, 60, 72, 58].map((width) => (
            <Skeleton key={width} className="h-5" style={{ width }} />
          ))}
        </div>
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex gap-3 px-6 py-2">
            <Skeleton className="size-6 rounded-full" />
            <div className="flex flex-1 flex-col gap-1.5">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          </div>
        ))}
      </div>
      <div className="hidden @3xl:block" />
    </div>
  );
}
