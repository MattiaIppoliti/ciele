"use client";

import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  ChevronRight,
  Ellipsis,
  MessageCircle,
  Plus,
  Search,
  ThumbsDown,
  ThumbsUp,
  type LucideIcon,
} from "lucide-react";
import type { AnimatedIcon } from "@/components/ui/animated-icon";
import { PREVIEW_SETUP_SECTIONS } from "@/components/home/preview-nav";
import { cn } from "@/lib/utils";
import {
  ASSISTANTS,
  BARS,
  CONVERSATIONS,
  DONUT_GRADIENT,
  DONUT_SEGMENTS,
  ESCALATED_PATH,
  HELP_DESKS,
  IMPROVEMENT_COLUMNS,
  INK_AREA_SOFT,
  INK_AREA_STRONG,
  INK_SOFT,
  INK_STRONG,
  LINE_DOTS,
  RESOLVED_PATH,
  STATS,
  type GlobalView,
  type View,
} from "@/components/home/preview-model";

/* The pane components for the marketing hero's live dashboard mock. Pure
   renderers over preview-model data; the shell (app-preview.tsx) owns state
   and composes these. See app-preview.tsx for the overall mock rationale. */

/* The hover-animated icons are the mock's only heavy dependency: the
   AnimatedIcon module statically pulls motion/react plus every animated
   icon variant — none of which the marketing page needs while the mock
   just idles through its views. So the icons start as plain lucide
   glyphs and the animated module is fetched on the first pointerenter,
   the earliest moment a hover animation could matter. Until it lands
   the context stays null and PreviewIcon renders the static glyph. */
type AnimatedIconRenderer = typeof AnimatedIcon;

export const PreviewIconContext = createContext<AnimatedIconRenderer | null>(
  null,
);

/* Compact mode — the mobile hero renders the same live mock, but framed
   on the top-left corner of the app (sidebar + start of the main pane)
   and scaled to the phone's width. Panes drop to single columns and hug
   the left edge so the visible slice reads as intentional UI instead of
   a cropped desktop layout. */
export const CompactContext = createContext(false);

export function PreviewIcon({
  icon: Icon,
  size = 16,
  className,
}: {
  icon: LucideIcon;
  size?: number;
  className?: string;
}) {
  const animated = useContext(PreviewIconContext);
  if (!animated) return <Icon size={size} className={className} />;
  return createElement(animated, { icon: Icon, size, className });
}

const ROW =
  "relative flex h-8 w-full items-center gap-2.5 rounded-lg px-2.5 text-sm font-medium transition-colors duration-300";
const ROW_IDLE = "text-muted-foreground hover:bg-muted hover:text-foreground";

export function NavRow({
  icon,
  label,
  active,
  badge,
  onSelect,
}: {
  icon: LucideIcon;
  label: string;
  active?: boolean;
  badge?: number;
  onSelect?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      // Focus inside the hero's 3D-transformed, contain:strict plane makes
      // the browser scroll-to-focus jump wildly — suppress mouse focus.
      onMouseDown={(event) => event.preventDefault()}
      className={cn(ROW, active ? "bg-muted text-foreground" : ROW_IDLE)}
    >
      <PreviewIcon icon={icon} size={16} className="shrink-0" />
      <span className="truncate">{label}</span>
      {badge ? (
        <span className="bg-destructive ml-auto flex size-4 items-center justify-center rounded-full text-[10px] font-semibold text-white">
          {badge}
        </span>
      ) : null}
    </button>
  );
}

/* ---------------------------------------------------------------- */
/* Assistants                                                        */
/* ---------------------------------------------------------------- */

function AssistantCard({
  title,
  nickname,
  description,
  id,
  className,
}: {
  title: string;
  nickname: string;
  description: string;
  id: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "bg-card hover:border-ring/40 group flex flex-col gap-3 rounded-xl border p-4 text-left shadow-xs transition-colors",
        className,
      )}
    >
      <div className="flex items-start justify-between">
        <span className="bg-muted flex size-9 items-center justify-center rounded-lg border">
          <PreviewIcon icon={MessageCircle} size={16} />
        </span>
        <span className="flex items-center gap-2">
          <span className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-xs">
            Active
          </span>
          <Ellipsis className="text-muted-foreground size-4" />
        </span>
      </div>
      <div>
        <span className="text-sm font-semibold">{title}</span>
        <span className="text-muted-foreground ml-2 text-xs">{nickname}</span>
        <p className="text-muted-foreground mt-1 line-clamp-2 text-sm">
          {description}
        </p>
      </div>
      <div className="mt-auto flex items-center gap-2">
        <span className="bg-muted text-muted-foreground flex items-center gap-1.5 rounded-md px-2 py-0.5 font-mono text-[11px]">
          <span className="size-1.5 rounded-full bg-emerald-500" />
          {id}
        </span>
        <span className="bg-muted text-muted-foreground rounded-md px-2 py-0.5 text-[11px]">
          Updated Jul 17
        </span>
      </div>
    </div>
  );
}

function AssistantsPane() {
  const compact = useContext(CompactContext);
  return (
    <div className={cn("flex-1 overflow-hidden", compact ? "p-4" : "p-6")}>
      <div className="flex items-center gap-3">
        <div className="bg-background text-muted-foreground flex h-10 flex-1 items-center gap-2 rounded-xl border px-3 text-sm">
          <PreviewIcon icon={Search} size={15} />
          Search Assistants…
        </div>
        <button
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          className="bg-primary text-primary-foreground flex h-10 items-center gap-1.5 rounded-xl px-4 text-sm font-medium"
        >
          <PreviewIcon icon={Plus} size={15} />
          Add New…
        </button>
      </div>

      <div
        className={cn(
          "grid gap-4",
          compact ? "mt-4 grid-cols-1 gap-3" : "mt-6 grid-cols-3",
        )}
      >
        {(compact ? ASSISTANTS.slice(0, 3) : ASSISTANTS).map(
          ({ wide, ...assistant }) => (
            <AssistantCard
              key={assistant.id}
              className={wide && !compact ? "col-span-2" : undefined}
              {...assistant}
            />
          ),
        )}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* Help Desks                                                        */
/* ---------------------------------------------------------------- */

function HelpDesksPane() {
  const compact = useContext(CompactContext);
  return (
    <div className={cn("flex-1 overflow-hidden", compact ? "p-4" : "p-6")}>
      <div className="flex items-center gap-3">
        <div className="bg-background text-muted-foreground flex h-10 flex-1 items-center gap-2 rounded-xl border px-3 text-sm">
          <PreviewIcon icon={Search} size={15} />
          Search Help Desks…
        </div>
        <button
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          className="bg-primary text-primary-foreground flex h-10 items-center gap-1.5 rounded-xl px-4 text-sm font-medium"
        >
          <PreviewIcon icon={Plus} size={15} />
          New Help Desk
        </button>
      </div>

      <div
        className={cn(
          "grid gap-4",
          compact ? "mt-4 grid-cols-1 gap-3" : "mt-6 grid-cols-3",
        )}
      >
        {(compact ? HELP_DESKS.slice(0, 3) : HELP_DESKS).map((desk) => (
          <div
            key={desk.name}
            className="bg-card hover:border-ring/40 flex flex-col gap-3 rounded-xl border p-4 shadow-xs transition-colors"
          >
            <div className="flex items-start justify-between">
              <span className="bg-muted flex size-9 items-center justify-center rounded-lg border text-base">
                {desk.emoji}
              </span>
              <Ellipsis className="text-muted-foreground size-4" />
            </div>
            <div>
              <span className="text-sm font-semibold">{desk.name}</span>
              <p className="text-muted-foreground mt-1 line-clamp-2 text-sm">
                {desk.description}
              </p>
            </div>
            <span className="bg-muted text-muted-foreground mt-auto w-fit rounded-md px-2 py-0.5 text-[11px]">
              {desk.meta}
            </span>
          </div>
        ))}
        {!compact && (
          <div className="text-muted-foreground flex min-h-36 flex-col items-center justify-center gap-2 rounded-xl border border-dashed p-4 text-sm">
            <PreviewIcon icon={Plus} size={18} />
            Create a help desk
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* Inbox                                                             */
/* ---------------------------------------------------------------- */

function InboxPane() {
  const compact = useContext(CompactContext);
  return (
    <div className="flex flex-1 overflow-hidden">
      <div
        className={cn(
          "bg-background w-80 shrink-0 overflow-hidden border-r",
          compact && "hidden",
        )}
      >
        <div className="bg-background text-muted-foreground m-3 flex h-9 items-center gap-2 rounded-lg border px-3 text-sm">
          <PreviewIcon icon={Search} size={14} />
          Search conversations…
        </div>
        {CONVERSATIONS.map((conversation) => (
          <div
            key={conversation.who + conversation.time}
            className={cn(
              "mx-3 mb-1 flex flex-col gap-1 rounded-lg px-3 py-2.5",
              conversation.active ? "bg-muted" : "hover:bg-muted/60",
            )}
          >
            <div className="flex items-center gap-2">
              <span className="truncate text-sm font-medium">
                {conversation.who}
              </span>
              <span className="text-muted-foreground ml-auto text-xs">
                {conversation.time}
              </span>
            </div>
            <p className="text-muted-foreground line-clamp-1 text-sm">
              {conversation.snippet}
            </p>
            <div className="flex items-center gap-2">
              <span className="bg-muted text-muted-foreground rounded-full border px-2 py-px text-[10px]">
                {conversation.assistant}
              </span>
              {conversation.up ? (
                <ThumbsUp className="size-3 text-emerald-500" />
              ) : (
                <ThumbsDown className="text-destructive size-3" />
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="flex h-12 shrink-0 items-center gap-2 border-b px-5 text-sm">
          <span className="font-medium">j.miller@acme.com</span>
          <span className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-xs">
            Acme Helpdesk
          </span>
          <span className="text-muted-foreground ml-auto text-xs">
            Today, 12:41
          </span>
        </div>
        <div className="flex-1 space-y-4 overflow-hidden p-5">
          <div className="bg-muted ml-auto w-fit max-w-[70%] rounded-2xl rounded-br-sm px-4 py-2.5 text-sm">
            How do I reset my VPN passphrase from home?
          </div>
          <div className="bg-card w-fit max-w-[75%] rounded-2xl rounded-bl-sm border px-4 py-2.5 text-sm shadow-xs">
            You can reset it yourself from the self-service portal: open{" "}
            <span className="font-medium">vpn.acme.com/reset</span>, sign in
            with SSO and follow the &ldquo;Reset passphrase&rdquo; flow. The new
            passphrase is active within 5 minutes.
            <div className="text-muted-foreground mt-2 flex items-center gap-2 text-xs">
              <span className="bg-muted rounded-md border px-1.5 py-0.5">
                IT KB · VPN access
              </span>
              <ThumbsUp className="size-3.5 text-emerald-500" />
              <ThumbsDown className="size-3.5" />
            </div>
          </div>
          <div className="bg-muted ml-auto w-fit max-w-[70%] rounded-2xl rounded-br-sm px-4 py-2.5 text-sm">
            Perfect, that worked. Thanks!
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* Improvements                                                      */
/* ---------------------------------------------------------------- */

function ImprovementsPane() {
  const compact = useContext(CompactContext);
  return (
    <div className={cn("flex-1 overflow-hidden", compact ? "p-4" : "p-6")}>
      <div
        className={cn(
          "grid h-full gap-4",
          compact ? "grid-cols-1 gap-3" : "grid-cols-3",
        )}
      >
        {(compact ? IMPROVEMENT_COLUMNS.slice(0, 2) : IMPROVEMENT_COLUMNS).map(
          (column) => (
            <div key={column.label} className="bg-muted/40 rounded-xl border p-3">
              <div className="flex items-center gap-2 px-1 pb-3">
                <span className="text-sm font-semibold">{column.label}</span>
                <span className="bg-muted text-muted-foreground rounded-full px-2 py-px text-xs">
                  {column.items.length}
                </span>
              </div>
              <div className="space-y-2">
                {column.items.map((item) => (
                  <div
                    key={item.title}
                    className="bg-card hover:border-ring/40 rounded-lg border p-3 shadow-xs transition-colors"
                  >
                    <p className="text-sm font-medium">{item.title}</p>
                    <div className="mt-2 flex items-center gap-2">
                      <span className="bg-muted text-muted-foreground rounded-full border px-2 py-px text-[10px]">
                        {item.assistant}
                      </span>
                      <span className="text-muted-foreground ml-auto text-xs">
                        {item.date}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ),
        )}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* Insights                                                          */
/* ---------------------------------------------------------------- */

function InsightsPane() {
  const compact = useContext(CompactContext);
  return (
    <div className={cn("flex-1 overflow-hidden", compact ? "p-4" : "p-6")}>
      <div className="flex items-center gap-2">
        <span className="bg-muted text-muted-foreground rounded-lg border px-3 py-1.5 text-sm">
          All Assistants
        </span>
        <span className="bg-muted text-muted-foreground rounded-lg border px-3 py-1.5 text-sm">
          Last 30 days
        </span>
      </div>

      <div
        className={cn(
          "mt-4 grid gap-4",
          compact ? "grid-cols-2 gap-3" : "grid-cols-4",
        )}
      >
        {STATS.map((stat) => (
          <div
            key={stat.label}
            className="bg-card rounded-xl border p-4 shadow-xs"
          >
            <p className="text-muted-foreground text-sm">{stat.label}</p>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-2xl font-semibold">{stat.value}</span>
              <span className="text-xs font-medium text-emerald-500">
                {stat.delta}
              </span>
            </div>
          </div>
        ))}
      </div>

      <div className="bg-card mt-4 rounded-xl border p-4 shadow-xs">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">Conversations per day</span>
          <span className="text-muted-foreground ml-auto text-xs">
            Jun 18, Jul 17
          </span>
        </div>
        <div
          className={cn(
            "mt-4 flex items-end gap-2",
            compact ? "h-24 gap-1.5" : "h-40",
          )}
        >
          {BARS.map((height, index) => (
            <div
              key={index}
              className="bg-primary/70 hover:bg-primary flex-1 rounded-t-md transition-colors"
              style={{ height: `${height}%` }}
            />
          ))}
        </div>
        <div className="text-muted-foreground mt-2 flex justify-between text-[10px]">
          <span>Jun 18</span>
          <span>Jun 27</span>
          <span>Jul 7</span>
          <span>Jul 17</span>
        </div>
      </div>

      <div
        className={cn(
          "mt-4 grid gap-4",
          compact ? "grid-cols-1 gap-3" : "grid-cols-2",
        )}
      >
        <div className="bg-card rounded-xl border p-4 shadow-xs">
          <div className="flex items-center gap-3">
            <span className="text-sm font-semibold">Resolved vs escalated</span>
            <span className="text-muted-foreground ml-auto flex items-center gap-1.5 text-[11px]">
              <span
                className="size-2 rounded-full"
                style={{ background: INK_STRONG }}
              />
              Resolved
            </span>
            <span className="text-muted-foreground flex items-center gap-1.5 text-[11px]">
              <span
                className="size-2 rounded-full"
                style={{ background: INK_SOFT }}
              />
              Escalated
            </span>
          </div>
          <div className="relative mt-3">
            <svg
              viewBox="0 0 320 120"
              preserveAspectRatio="none"
              className="block h-36 w-full"
            >
              {[30, 60, 90].map((y) => (
                <line
                  key={y}
                  x1="0"
                  x2="320"
                  y1={y}
                  y2={y}
                  style={{ stroke: "var(--border)" }}
                  strokeDasharray="4 4"
                  vectorEffect="non-scaling-stroke"
                />
              ))}
              <path
                d={`${RESOLVED_PATH} L320,120 L0,120 Z`}
                style={{ fill: INK_AREA_STRONG }}
              />
              <path
                d={`${ESCALATED_PATH} L320,120 L0,120 Z`}
                style={{ fill: INK_AREA_SOFT }}
              />
              <path
                d={RESOLVED_PATH}
                fill="none"
                style={{ stroke: INK_STRONG }}
                strokeWidth="2"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
              <path
                d={ESCALATED_PATH}
                fill="none"
                style={{ stroke: INK_SOFT }}
                strokeWidth="2"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
            </svg>
            {LINE_DOTS.map((dot, index) => (
              <span
                key={index}
                className="absolute size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full"
                style={{ left: dot.left, top: dot.top, background: dot.ink }}
              />
            ))}
          </div>
          <div className="text-muted-foreground mt-1 flex justify-between text-[10px]">
            <span>W1</span>
            <span>W4</span>
            <span>W8</span>
            <span>W12</span>
          </div>
        </div>

        <div className="bg-card rounded-xl border p-4 shadow-xs">
          <span className="text-sm font-semibold">
            Conversations by assistant
          </span>
          <div className="mt-3 flex items-center gap-5">
            <div
              className="relative size-36 shrink-0 rounded-full"
              style={{ background: DONUT_GRADIENT }}
            >
              <div className="bg-card absolute inset-4 flex flex-col items-center justify-center rounded-full">
                <span className="text-lg font-semibold">1,284</span>
                <span className="text-muted-foreground text-[10px]">total</span>
              </div>
            </div>
            <div className="grid flex-1 grid-cols-2 gap-x-3 gap-y-2">
              {DONUT_SEGMENTS.map((segment) => (
                <div key={segment.label} className="flex items-center gap-1.5">
                  <span
                    className="size-2 shrink-0 rounded-full"
                    style={{ background: segment.color }}
                  />
                  <span className="text-muted-foreground truncate text-[11px]">
                    {segment.label}
                  </span>
                  <span className="ml-auto text-[11px] font-medium">
                    {segment.value}%
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* Setup picker — same screen for every SETUP section                */
/* ---------------------------------------------------------------- */

export function SetupPane({ slug }: { slug: string }) {
  const compact = useContext(CompactContext);
  const section = PREVIEW_SETUP_SECTIONS.find(
    (candidate) => candidate.slug === slug
  );
  if (!section) return null;
  const Icon = section.icon;

  return (
    <div className={cn("flex-1 overflow-hidden", compact ? "p-4" : "p-6")}>
      <div
        className={cn(
          "mx-auto flex max-w-md flex-col items-center",
          compact ? "pt-2" : "pt-8",
        )}
      >
        <span className="bg-muted flex size-14 items-center justify-center rounded-xl border">
          <Icon className="text-muted-foreground size-6" />
        </span>
        <h2 className="mt-5 text-xl font-semibold tracking-tight">
          Continue to {section.label}
        </h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Choose an assistant to continue
        </p>

        <div className="bg-background mt-8 w-full rounded-xl p-2">
          <div className="bg-background flex items-center gap-2 rounded-lg border px-3 shadow-xs">
            <Search className="text-muted-foreground size-4 shrink-0" />
            <span className="text-muted-foreground flex h-11 items-center text-sm">
              Find Assistant...
            </span>
          </div>

          <div className="mt-4 flex flex-col gap-1">
            {ASSISTANTS.map((assistant) => (
              <div
                key={assistant.id}
                className="group hover:bg-muted flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors"
              >
                <span className="bg-primary/80 size-4 shrink-0 rounded-full" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{assistant.title}</span>
                  <span className="text-muted-foreground block truncate text-xs font-normal">
                    {assistant.nickname}
                  </span>
                </span>
                <ChevronRight className="text-muted-foreground size-4 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* Animated square grid behind the main pane                         */
/* ---------------------------------------------------------------- */

/* Same treatment as AuthGrid on /contact/sales — drifting square grid
   with a cursor-following highlight — but theme-aware via color-mix on
   --foreground instead of a fixed light/dark tone, since the mock swaps
   themes with the page. Listeners attach to the parent pane so the grid
   itself never intercepts clicks. */
const PREVIEW_GRID_IMAGE =
  "linear-gradient(to right, color-mix(in oklab, var(--foreground) 6%, transparent) 1px, transparent 1px), linear-gradient(to bottom, color-mix(in oklab, var(--foreground) 6%, transparent) 1px, transparent 1px)";
const PREVIEW_GRID_HIGHLIGHT =
  "linear-gradient(to right, color-mix(in oklab, var(--foreground) 30%, transparent) 1px, transparent 1px), linear-gradient(to bottom, color-mix(in oklab, var(--foreground) 30%, transparent) 1px, transparent 1px)";

export function PreviewGrid() {
  const gridRef = useRef<HTMLDivElement>(null);
  const [cursor, setCursor] = useState({ x: -320, y: -320 });

  useEffect(() => {
    const container = gridRef.current?.parentElement;
    if (!container) return;

    const handlePointerMove = (event: PointerEvent) => {
      const bounds = container.getBoundingClientRect();
      setCursor({
        x: event.clientX - bounds.left,
        y: event.clientY - bounds.top,
      });
    };
    const clearCursor = () => setCursor({ x: -320, y: -320 });

    container.addEventListener("pointermove", handlePointerMove);
    container.addEventListener("pointerleave", clearCursor);
    return () => {
      container.removeEventListener("pointermove", handlePointerMove);
      container.removeEventListener("pointerleave", clearCursor);
    };
  }, []);

  return (
    <div
      ref={gridRef}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0"
    >
      {/* Slower drift than the shared 12s (login/contact sales): inside the
          mock the grid is close to real content, so it should barely move.
          Both layers share the duration to keep their lines aligned. */}
      <div
        className="auth-grid-layer absolute inset-0"
        style={{
          backgroundImage: PREVIEW_GRID_IMAGE,
          animationDuration: "32s",
        }}
      />
      <div
        className="auth-grid-layer absolute inset-0"
        style={{
          backgroundImage: PREVIEW_GRID_HIGHLIGHT,
          animationDuration: "32s",
          maskImage: `radial-gradient(300px circle at ${cursor.x}px ${cursor.y}px, black, transparent)`,
          WebkitMaskImage: `radial-gradient(300px circle at ${cursor.x}px ${cursor.y}px, black, transparent)`,
        }}
      />
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* Pane registry                                                     */
/* ---------------------------------------------------------------- */

export const GLOBAL_PANES: Record<GlobalView, () => React.ReactNode> = {
  Assistants: AssistantsPane,
  "Help Desks": HelpDesksPane,
  Inbox: InboxPane,
  Improvements: ImprovementsPane,
  Insights: InsightsPane,
};

/* Render the pane for a given view (global pane or the shared setup picker). */
export function PreviewPane({ view }: { view: View }) {
  if (view.kind === "global") {
    const Pane = GLOBAL_PANES[view.label];
    return <Pane />;
  }
  return <SetupPane slug={view.slug} />;
}
