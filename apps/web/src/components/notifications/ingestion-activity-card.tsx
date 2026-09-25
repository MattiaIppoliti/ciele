"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CircleCheck, OctagonX, X } from "lucide-react";
import { ChevronDown, LoaderCircle } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useFeedback } from "@agent-hub/ui/feedback";
import { EASE_OUT, SPRING_LAYOUT } from "@/lib/ease";
import { setIngestionListener } from "@/lib/ingestion-bus";
import {
  dismissIngestionActivity,
  emptyIngestionActivity,
  expireIngestionActivity,
  ingestionActivityBusy,
  ingestionActivityCard,
  ingestionStatusLabel,
  mergeIngestionSnapshot,
  trackedIngestionIds,
  type IngestionActivityItem,
  type IngestionActivitySnapshot,
  type IngestionActivityState,
  type IngestionItemStatus,
} from "@/lib/ingestion-activity";
import { cn } from "@/lib/utils";

/**
 * The bottom-right crawl / import progress card.
 *
 * Starting a crawl used to be a toast and then silence: the Source sat at
 * "processing" on a page you had probably navigated away from, and the next
 * thing you heard was a `crawl` Alert if it failed. This follows the work
 * instead, from anywhere in the console, and steps aside when it finishes.
 *
 * It polls rather than streams. Crawl progress is written by whichever worker
 * or cron tick advances it, not by this request, so there is no stream to hold
 * open; a timer that only runs while something is in flight costs an idle
 * console nothing. The whole merge, ordering and copy is
 * `@/lib/ingestion-activity`, which is where it is tested.
 */

/** While something is in flight. Fast enough to feel live, slow enough to be free. */
const POLL_MS = 2_500;
/** After a poll that found nothing: the run may still be starting up. */
const IDLE_MS = 6_000;
/** Idle polls before the card gives up on work that never appeared. */
const IDLE_ATTEMPTS = 4;

export function IngestionActivityCard({
  initialActive = false,
}: {
  /**
   * Whether the Organization already had ingestion in flight when the page was
   * rendered, so a reload mid-crawl brings the card back. One tally read in
   * the shell, which is cheaper than an unconditional poll on every page load.
   */
  initialActive?: boolean;
}) {
  const router = useRouter();
  const reduce = useReducedMotion();
  const { play } = useFeedback();
  const [state, setState] = useState<IngestionActivityState>(emptyIngestionActivity);
  const [expanded, setExpanded] = useState(false);
  const [watch, setWatch] = useState(initialActive ? 1 : 0);

  // The ref is the authoritative copy and `state` is the rendered mirror of
  // it: the poll loop has to read the latest list without being torn down and
  // restarted every time it produces one.
  const stateRef = useRef(state);
  const commit = useCallback((next: IngestionActivityState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const look = useCallback(() => setWatch((token) => token + 1), []);
  useEffect(() => {
    setIngestionListener(look);
    return () => setIngestionListener(null);
  }, [look]);

  useEffect(() => {
    if (watch === 0) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    let idle = 0;

    const poll = async (): Promise<IngestionActivitySnapshot | null> => {
      const tracked = trackedIngestionIds(stateRef.current);
      const query = new URLSearchParams();
      if (tracked.sources.length > 0) query.set("sources", tracked.sources.join(","));
      if (tracked.imports.length > 0) query.set("imports", tracked.imports.join(","));
      const response = await fetch(
        `/api/knowledge/ingestion-activity?${query.toString()}`,
        { cache: "no-store" },
      );
      if (!response.ok) return null;
      return (await response.json()) as IngestionActivitySnapshot;
    };

    const tick = async () => {
      // A background tab neither polls nor expires: coming back to a card
      // frozen at the last thing you saw beats coming back to an empty corner.
      if (typeof document !== "undefined" && document.hidden) {
        timer = setTimeout(tick, IDLE_MS);
        return;
      }

      const now = Date.now();
      const before = stateRef.current;
      let next = expireIngestionActivity(before, now);
      try {
        const snapshot = await poll();
        if (cancelled) return;
        if (snapshot) next = mergeIngestionSnapshot(next, snapshot, now);
      } catch {
        // Transient; the next tick asks again.
      }
      if (cancelled) return;

      const busy = ingestionActivityBusy(next);
      if (busy) idle = 0;
      else idle += 1;

      // Work that finished while we were watching: say so, once, and let the
      // page behind the card catch up with its own server data.
      const wasBusy = ingestionActivityBusy(before);
      if (wasBusy && !busy) {
        play(next.items.some((item) => item.status === "failed") ? "error" : "success");
        router.refresh();
      }

      commit(next);

      if (!busy && (next.items.length === 0 || idle >= IDLE_ATTEMPTS)) {
        // Nothing left to follow. Any rows still on screen (a failure waits to
        // be dismissed) stay exactly as they are.
        return;
      }
      timer = setTimeout(tick, busy ? POLL_MS : IDLE_MS);
    };

    void tick();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [watch, commit, play, router]);

  const card = ingestionActivityCard(state);
  if (!card) return null;

  const dismiss = () => {
    commit(dismissIngestionActivity(stateRef.current, Date.now()));
    setExpanded(false);
  };

  const progress = card.total > 0 ? Math.min(1, card.done / card.total) : 0;

  return (
    <motion.section
      layout={reduce ? false : "position"}
      transition={reduce ? { duration: 0 } : SPRING_LAYOUT}
      initial={reduce ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      aria-label="Knowledge ingestion activity"
      className="bg-background/95 border-border/70 pointer-events-auto w-[22rem] max-w-full overflow-hidden rounded-3xl border shadow-lg backdrop-blur"
    >
      <div className="flex items-center gap-2 px-4 py-3">
        <span className="min-w-0 flex-1 truncate text-sm font-medium">
          {card.title}
        </span>
        {card.count ? (
          <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
            {card.count}
          </span>
        ) : null}
        {/* Hides the card, and only that: a 20-minute crawl you are not
            watching should be dismissible, and the poll carries on behind it,
            so the next thing that starts brings the card back. */}
        <button
          type="button"
          onClick={dismiss}
          aria-label="Hide activity"
          title="Hide. This does not stop the work."
          className="press-control text-muted-foreground hover:text-foreground focus-visible:ring-ring shrink-0 cursor-pointer rounded-full p-1 outline-none focus-visible:ring-2"
        >
          <X className="size-3.5" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => setExpanded((open) => !open)}
          aria-expanded={expanded}
          aria-label={expanded ? "Hide sources" : "Show sources"}
          className="press-control border-border/70 text-muted-foreground hover:text-foreground focus-visible:ring-ring shrink-0 cursor-pointer rounded-lg border p-1 outline-none focus-visible:ring-2"
        >
          <motion.span
            animate={{ rotate: expanded ? 0 : 180 }}
            initial={false}
            transition={reduce ? { duration: 0 } : { duration: 0.2, ease: EASE_OUT }}
            className="block"
          >
            <ChevronDown className="size-4" aria-hidden="true" />
          </motion.span>
        </button>
      </div>

      {/* One hairline of progress. Present only where it can be honest: a
          single crawl has no denominator until its pages are staged. It stays
          neutral when items fail: a bar that turns red at one failure in 291
          says the run collapsed, which is the rows' job to say, accurately. */}
      {card.total > 1 ? (
        <div className="bg-border/60 h-0.5 w-full" aria-hidden="true">
          <motion.div
            className="bg-primary h-full"
            initial={false}
            animate={{ scaleX: progress }}
            style={{ transformOrigin: "left" }}
            transition={reduce ? { duration: 0 } : { duration: 0.4, ease: EASE_OUT }}
          />
        </div>
      ) : null}

      <AnimatePresence initial={false}>
        {expanded ? (
          <motion.div
            key="rows"
            initial={reduce ? false : { height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
            transition={reduce ? { duration: 0 } : { duration: 0.28, ease: EASE_OUT }}
            className="overflow-hidden"
          >
            <ul className="list-none">
              {card.items.map((item) => (
                <ActivityRow key={item.id} item={item} />
              ))}
            </ul>
            {card.overflow > 0 ? (
              <p className="border-border/60 text-muted-foreground border-t px-4 py-2.5 text-xs">
                +{card.overflow} queued
              </p>
            ) : null}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </motion.section>
  );
}

function ActivityRow({ item }: { item: IngestionActivityItem }) {
  return (
    <li className="border-border/60 flex items-center gap-3 border-t px-4 py-3">
      <StatusGlyph status={item.status} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm">{item.name}</span>
        {item.detail ? (
          <span className="text-muted-foreground block truncate text-xs">
            {item.detail}
          </span>
        ) : null}
      </span>
      <span className={cn("shrink-0 text-xs", STATUS_TEXT[item.status])}>
        {ingestionStatusLabel(item.status)}
      </span>
    </li>
  );
}

const STATUS_TEXT: Record<IngestionItemStatus, string> = {
  queued: "text-muted-foreground",
  running: "text-muted-foreground",
  indexed: "text-emerald-600 dark:text-emerald-400",
  failed: "text-destructive",
};

function StatusGlyph({ status }: { status: IngestionItemStatus }) {
  const label = ingestionStatusLabel(status);
  const glyph =
    status === "failed" ? (
      <OctagonX className="text-destructive size-4" aria-hidden="true" />
    ) : status === "indexed" ? (
      <CircleCheck
        className="size-4 text-emerald-600 dark:text-emerald-400"
        aria-hidden="true"
      />
    ) : status === "running" ? (
      <LoaderCircle
        className="text-muted-foreground size-4 animate-spin motion-reduce:animate-none"
        aria-hidden="true"
      />
    ) : (
      <span
        className="bg-muted-foreground/40 size-2 rounded-[3px]"
        aria-hidden="true"
      />
    );

  return (
    <span className="flex size-4 shrink-0 items-center justify-center">
      {glyph}
      <span className="sr-only">{label}: </span>
    </span>
  );
}
