"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { type ReactNode, useDeferredValue, useEffect, useId, useMemo, useRef, useState } from "react";
import type {
  AnswerVerdict,
  ImprovementMessageLink,
  InboxConversation,
  InboxFacets,
  InboxPage,
  InboxQuery,
  ReviewRequest,
  StoredMessage,
} from "@agent-hub/core";
import {
  feedbackReactionById,
  feedbackReactionScore,
  isoDay,
  messageText,
  type FeedbackReactionId,
} from "@agent-hub/core";
import { useExitTransition } from "@/components/motion/use-exit-transition";

import type { ChatReplyPart } from "@agent-hub/agent/client";
import { CirclePlay, Download, ExternalLink, MessageSquareDashed, Search, ShieldCheck, SquareCheck, WandSparkles, Wrench, X } from "lucide-react";
import { Calendar as CalendarIcon, ChevronLeft, Headphones, HelpCircle, Info, ListFilter, Radio, ShieldAlert } from "lucide-react";
import { EmojiFeedback } from "@/components/chat/emoji-feedback";
import { toast } from "@/lib/toast";
import {
  exportInboxConversationsAction,
  exportInboxSummariesAction,
  getInboxFacetsAction,
  getInboxConversationReviewAction,
  getInboxPageAction,
  listConversationImprovementLinksAction,
  setConversationLegalHoldAction,
  setMessageFeedbackAction,
} from "@/app/actions";
import {
  listConversationReviewsAction,
  listPendingReviewConversationIdsAction,
} from "@/app/(admin)/reviews/actions";
import { transcriptDocument } from "@/lib/inbox/transcript-print";
import {
  defaultInboxFilters,
  defaultInboxUrlState,
  inboxQueryFromFilters,
  subjectName,
  type InboxFilters,
} from "@/lib/inbox/conversation-filter";
import { replaceFilterParams } from "@/lib/url-state";
import { StudyProvider } from "@/components/chat/study-context";
import { ProgressLine } from "@/components/chat/progress-line";
import { PreflightRecordPanel } from "@/components/inbox/preflight-record";
import {
  storedTraceLabel,
  terminalBadge,
  visibleTraceSteps,
} from "@/components/chat/stored-trace";
import { Badge } from "@agent-hub/ui";
import { Button } from "@agent-hub/ui";
import { Card } from "@agent-hub/ui";
import { Popover, PopoverContent, PopoverTrigger } from "@agent-hub/ui";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@agent-hub/ui";
import { FIELD_CLASS, FilterSelect } from "@/components/ui/filter-select";
import { formatDateTime, formatDay, formatTime } from "@/lib/format";
import { reviewDecisionLabel } from "@/lib/review-status";
import { EmptyState } from "@/components/ui/empty-state";
import { conversationSummaryCsv } from "@/lib/inbox/conversation-export";
import { downloadFile } from "@/lib/download";
import { RollInText } from "@/components/motion/roll-in-text";
import { RollingNumber } from "@/components/motion/rolling-number";
import { useConfirmDelete } from "@/components/ui/confirm-delete-modal";

// Transcript-only UI stays out of the Inbox list's initial bundle. In
// particular ChatMarkdown owns syntax highlighting, which is wasted until a
// reviewer opens a conversation. Plain `dynamic()`, no `ssr: false`: these
// render fine on the server, and the flag would only have hidden them from
// the first paint of a transcript that was requested by URL.
const CitationList = dynamic(() =>
  import("@/components/chat/citation-list").then((module) => module.CitationList),
);
const ComponentReplyPart = dynamic(() =>
  import("@/components/chat/component-part").then(
    (module) => module.ComponentReplyPart,
  ),
);
const ChatMarkdown = dynamic(() =>
  import("@/components/chat/chat-markdown").then((module) => module.ChatMarkdown),
);
const ThinkingPanel = dynamic(() =>
  import("@/components/chat/thinking-panel").then(
    (module) => module.ThinkingPanel,
  ),
);
// Mounted only once a reviewer clicks "Improve Answer", so it never renders
// on the server either way; the split keeps the dialog's form out of the list.
const ImproveAnswerDialog = dynamic(() =>
  import("@/components/inbox/improve-answer-dialog").then(
    (module) => module.ImproveAnswerDialog,
  ),
);
// The date picker's calendar carries react-day-picker (about 5 KB gzip, the
// difference between the Inbox route passing and failing its 50 KB budget)
// and opens only from the Filters popover, so it loads on demand. Through
// the component's own module path: a dynamic import of the `@agent-hub/ui`
// barrel this file already imports statically would defer nothing.
// `ssr: false` because a popover is never open on the server.
const Calendar = dynamic(
  () => import("@agent-hub/ui/calendar").then((module) => module.Calendar),
  { ssr: false },
);

interface AssistantOption {
  id: string;
  title: string;
}

/** A timestamp's day, in UTC like every other date here, so SSR and hydration agree. */
function dayLabel(iso: string): string {
  return formatDay(iso);
}

/**
 * A stored yyyy-mm-dd filter bound. Pinned to UTC noon: a bare local "T12:00"
 * lands on the previous UTC day east of UTC+12.
 */
function filterDayLabel(day: string): string {
  return formatDay(`${day}T12:00:00Z`);
}

/** Tailwind's `lg`: below it the list and the thread share one pane. */
const LG_QUERY = "(min-width: 64rem)";

/**
 * Per-message time in the transcript. The conversation header already carries
 * the date, so a turn only needs its clock time, and reviewing a transcript
 * means reading the gaps between turns.
 */
function MessageTime({ iso }: { iso: string }) {
  return (
    <time
      dateTime={iso}
      title={formatDateTime(iso)}
      className="text-muted-foreground/70 mt-1 block text-2xs"
    >
      {formatTime(iso)}
    </time>
  );
}

/**
 * The Thinking panel's footer caveat. Says out loud when the stored trace is
 * not the whole turn, reasoning withheld by the Role gate, or steps the
 * runtime clipped on write, so a short panel is never mistaken for a turn that
 * did little work.
 */
function traceNote(trace: {
  hiddenThoughts: number;
  truncated: boolean;
}): string | undefined {
  const notes: string[] = [];
  if (trace.hiddenThoughts > 0) {
    notes.push(
      `${trace.hiddenThoughts} reasoning ${
        trace.hiddenThoughts === 1 ? "step is" : "steps are"
      } visible to admins only`
    );
  }
  if (trace.truncated) notes.push("this trace was shortened when it was saved");
  return notes.length > 0 ? `${notes.join("; ")}.` : undefined;
}

/** Parse a yyyy-mm-dd string to a local Date (no timezone shift). */
function parseIsoDay(iso: string): Date | undefined {
  if (!iso) return undefined;
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return undefined;
  return new Date(y, m - 1, d);
}

/** shadcn Date Picker: Popover + Calendar, storing a yyyy-mm-dd string. */
function conversationHref(id: string): string {
  return `/inbox?conversation=${encodeURIComponent(id)}`;
}

/** Set or clear `?conversation=` in place, leaving the filters beside it. */
function replaceConversationParam(id: string | null) {
  const params = new URLSearchParams(window.location.search);
  if (id) params.set("conversation", id);
  else params.delete("conversation");
  const query = params.toString();
  window.history.replaceState(
    window.history.state,
    "",
    `${window.location.pathname}${query ? `?${query}` : ""}`,
  );
}

function DateField({
  value,
  onChange,
  className,
  label,
}: {
  value: string;
  onChange: (iso: string) => void;
  className?: string;
  /** Names the trigger, whose own text is only the date or "Pick a date". */
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = parseIsoDay(value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            data-empty={!selected}
            aria-label={selected ? `${label}: ${filterDayLabel(value)}` : `${label}: not set`}
            className={`justify-start px-3 font-normal data-[empty=true]:text-muted-foreground ${className ?? ""}`}
          />
        }
      >
        <CalendarIcon className="size-4" />
        {selected ? filterDayLabel(value) : <span>Pick a date</span>}
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0">
        <Calendar
          mode="single"
          selected={selected}
          onSelect={(date) => {
            onChange(date ? isoDay(date) : "");
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

function subjectInitials(c: InboxConversation): string {
  const name = subjectName(c);
  return (
    name
      .split(/[\s._-]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0])
      .join("")
      .toUpperCase() || "?"
  );
}

/** The divider naming the Flow that started or finished a turn. */
function WorkflowMarker({
  icon,
  children,
}: {
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center justify-center gap-2 py-1">
      <span className="bg-border h-px flex-1" />
      <span className="text-muted-foreground inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium">
        {icon}
        {children}
      </span>
      <span className="bg-border h-px flex-1" />
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="min-w-0">
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className="truncate text-sm" title={value ?? undefined}>
        {value || "N/A"}
      </p>
    </div>
  );
}

/**
 * The "Pending reviews" filter (#841): the Inbox query has no review column,
 * so the ids of Conversations waiting on a Human review are read from the
 * review rows and passed through the existing `conversationIds` narrowing. An
 * empty set has to yield an empty page, hence the impossible id.
 */
async function withPendingReviews(
  query: InboxQuery,
  review: InboxFilters["review"],
): Promise<InboxQuery> {
  if (review !== "pending") return query;
  const ids = await listPendingReviewConversationIdsAction();
  const narrowed = query.conversationIds
    ? ids.filter((id) => query.conversationIds!.includes(id))
    : ids;
  return { ...query, conversationIds: narrowed.length > 0 ? narrowed : ["__no_pending_reviews__"] };
}

function MessagePart({ part }: { part: ChatReplyPart }) {
  if (part.type === "text") {
    return <ChatMarkdown text={part.text} className="max-w-[85%] text-sm" />;
  }
  if (part.type === "progress") {
    // The narration the Visitor watched stream, kept as its own part so the
    // transcript shows exactly what they saw, and stays distinguishable from
    // the answer itself (#560).
    return <ProgressLine text={part.text} className="max-w-[85%]" />;
  }
  if (part.type === "human_review") {
    // The gate (#841): the human step is part of the transcript.
    return (
      <div className="max-w-[85%] space-y-1 rounded-2xl border-l-2 bg-muted/50 px-3.5 py-3 text-sm">
        <p className="text-muted-foreground text-xs font-medium uppercase">Human review</p>
        <p className="font-medium [overflow-wrap:anywhere]">{part.title}</p>
        <p className="text-muted-foreground text-xs">
          {reviewDecisionLabel(part)}
          {part.simulated ? " · simulated" : ""}
        </p>
      </div>
    );
  }
  if (part.type === "webhook") {
    // The callback gate (#842): the wait is part of the transcript. Written
    // once when the gate opened; how it closed arrives as the continuation's
    // own parts, so this card never changes state.
    let host = part.subscribeUrl;
    try {
      host = new URL(part.subscribeUrl).host;
    } catch {
      /* an unresolved template; the raw string is still informative */
    }
    return (
      <div className="max-w-[85%] space-y-1 rounded-2xl border-l-2 bg-muted/50 px-3.5 py-3 text-sm">
        <p className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium uppercase">
          <Radio className="size-3.5" />
          HTTP webhook
        </p>
        <p className="font-medium [overflow-wrap:anywhere]">Waited on {host}</p>
        <p className="text-muted-foreground text-xs">
          Until {formatDateTime(part.expiresAt)}
          {part.simulated ? " · simulated" : ""}
        </p>
      </div>
    );
  }
  if (part.type === "notification") {
    // A proactive nudge: the assistant spoke first, so the transcript marks it
    // as such rather than showing it as an answer to something.
    return (
      <div className="max-w-[85%] space-y-1 rounded-2xl border-l-2 bg-muted/50 px-3.5 py-3 text-sm">
        <p className="text-muted-foreground text-xs font-medium uppercase">
          Notification
        </p>
        {part.title && <p className="font-medium [overflow-wrap:anywhere]">{part.title}</p>}
        <ChatMarkdown text={part.content} className="text-sm" />
      </div>
    );
  }
  if (part.type === "clarify") {
    return (
      <div className="max-w-[85%] rounded-2xl border border-dashed px-3.5 py-3 text-sm">
        <div className="text-muted-foreground flex items-center gap-1.5">
          <HelpCircle className="size-4" />
          <span className="text-xs font-medium tracking-wide uppercase">
            Asked for clarification
          </span>
        </div>
        <p className="mt-1.5 [overflow-wrap:anywhere]">{part.question}</p>
        {part.found && part.found.length > 0 && (
          <div className="text-muted-foreground mt-2 text-xs [overflow-wrap:anywhere]">
            <span>Surfaced before asking:</span>
            <ul className="mt-1 list-disc space-y-0.5 pl-4">
              {part.found.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  }
  if (part.type === "sources") {
    // A disclosure in the transcript (#561): a reviewer scanning turns opens the
    // provenance for the one they are questioning, and the chips still link out.
    return (
      <CitationList sources={part.sources} className="max-w-[85%]" collapsible />
    );
  }
  if (part.type === "tool_calls") {
    // Audit trail (#665): which tools produced this answer.
    return (
      <div className="max-w-[85%] rounded-2xl border border-dashed px-3.5 py-2.5">
        <p className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium tracking-wide uppercase">
          <Wrench className="size-3.5" />
          Tool calls
        </p>
        <ul className="mt-1.5 space-y-1 text-xs">
          {part.calls.map((call, i) => (
            <li key={i} className="flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className={
                  call.ok ? "text-emerald-500" : "text-red-400"
                }
              >
                ●
              </span>
              <span className="sr-only">{call.ok ? "succeeded:" : "failed:"}</span>
              <span className="font-mono font-medium">{call.tool}</span>
              <span className="text-muted-foreground truncate">
                {call.summary ? `— ${call.summary}` : `— ${call.label}`}
              </span>
            </li>
          ))}
        </ul>
      </div>
    );
  }
  if (part.type === "help_desk") {
    return (
      <div className="flex max-w-[85%] items-center gap-3 rounded-2xl border px-3.5 py-3">
        <span className="bg-primary/10 text-primary flex size-8 shrink-0 items-center justify-center rounded-full">
          <Headphones className="size-4" />
        </span>
        <p className="min-w-0 text-sm font-medium [overflow-wrap:anywhere]">{part.label}</p>
      </div>
    );
  }
  if (part.type === "button") {
    return (
      <a
        href={part.url}
        target="_blank"
        rel="noopener noreferrer"
        className="bg-primary focus-visible:ring-ring inline-flex max-w-[85%] items-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold text-white transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
      >
        <span className="min-w-0 [overflow-wrap:anywhere]">{part.label}</span>
        <ExternalLink aria-hidden="true" className="size-3 shrink-0" />
      </a>
    );
  }
  if (part.type === "component") {
    // The same component the Visitor was shown: this is what the `showPart`
    // collector in the runtime exists for. No `onAsk` here, a transcript is a
    // record, and its rows are not buttons a Member can press.
    return <ComponentReplyPart part={part} />;
  }
  if (part.type === "iframe") {
    return (
      <span className="text-foreground/80 inline-flex max-w-[85%] items-center gap-1.5 truncate rounded-md border px-2.5 py-1 text-xs">
        <span className="truncate">
          {part.title?.trim() || "Embedded content"}: {part.url}
        </span>
        <ExternalLink className="text-muted-foreground size-3 shrink-0" />
      </span>
    );
  }
  if (part.type === "follow_ups") {
    return (
      <div className="flex max-w-[85%] flex-wrap gap-2">
        {part.questions.map((q) => (
          <span
            key={q}
            className="border-primary/30 text-primary max-w-full rounded-full border px-3 py-1 text-xs font-medium [overflow-wrap:anywhere]"
          >
            {q}
          </span>
        ))}
      </div>
    );
  }
  return null;
}

export function InboxClient({
  initialPage,
  initialFilters,
  initialSearch = "",
  assistants,
  canEdit = false,
  canViewReasoning = false,
  canOverseeChannels = false,
  canManageRetention = false,
}: {
  initialPage: InboxPage;
  /** The filters the URL asked for; the server already read this page with them. */
  initialFilters?: InboxFilters;
  initialSearch?: string;
  assistants: AssistantOption[];
  canEdit?: boolean;
  /** Admins and above see the model's own reasoning in the trace (#557). */
  canViewReasoning?: boolean;
  /**
   * Owners and Admins also oversee the internal group threads (#778, story 15).
   * Their own surface rather than a filter here: a channel has no subject and no
   * Assistant, so it would be two empty columns in this table.
   */
  canOverseeChannels?: boolean;
  /**
   * Legal hold suspends a deletion the Organization has committed to, so the
   * toggle is `manageMembers` like the retention setting itself (#801, CYB-12).
   * Everyone still sees the status: a held conversation behaves differently.
   */
  canManageRetention?: boolean;
}) {
  const [conversations, setConversations] = useState(
    initialPage.conversations,
  );
  const [nextCursor, setNextCursor] = useState(initialPage.nextCursor);
  const [loadingList, setLoadingList] = useState(false);
  const [facets, setFacets] = useState<InboxFacets | null>(null);
  const [loadingFacets, setLoadingFacets] = useState(false);
  const searchParams = useSearchParams();
  // Deep link from an improvement's "View message in conversation context".
  const requestedId = searchParams.get("conversation");
  const initialId =
    requestedId && conversations.some((c) => c.id === requestedId)
      ? requestedId
      : null;

  const [search, setSearch] = useState(initialSearch);
  // The list query and the address bar follow the search at low priority, so a
  // keystroke paints the field before either catches up.
  const deferredSearch = useDeferredValue(search);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filtersPanelId = useId();
  const filtersTriggerRef = useRef<HTMLButtonElement>(null);
  const filtersHeadingRef = useRef<HTMLHeadingElement>(null);
  // Set by a pointerdown that React bubbled through the panel. That includes
  // the portaled Select and date popups, which the panel's DOM never contains.
  const pointerInFilters = useRef(false);
  const [filters, setFilters] = useState<InboxFilters>(
    initialFilters ?? defaultInboxFilters,
  );
  // The address bar follows the filters and the search, so a reload or a copied
  // link lands on the same view; `?conversation=` rides along untouched.
  useEffect(() => {
    replaceFilterParams({ ...filters, q: deferredSearch }, defaultInboxUrlState());
  }, [filters, deferredSearch]);
  const [selectedId, setSelectedId] = useState<string | null>(initialId);
  const [messages, setMessages] = useState<StoredMessage[] | null>(null);
  const [transcriptError, setTranscriptError] = useState(false);
  const [links, setLinks] = useState<ImprovementMessageLink[]>([]);
  const [reviews, setReviews] = useState<ReviewRequest[]>([]);
  const [verdicts, setVerdicts] = useState<AnswerVerdict[]>([]);
  const [improveMessageId, setImproveMessageId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [legalHoldPending, setLegalHoldPending] = useState(false);
  const { confirmDelete, confirmDeleteModal } = useConfirmDelete();
  const threadHeadingRef = useRef<HTMLHeadingElement>(null);
  const detailsButtonRef = useRef<HTMLButtonElement>(null);
  const detailsHeadingRef = useRef<HTMLHeadingElement>(null);
  // Below `lg` the list and the thread swap places, so focus has to follow:
  // into the thread on select, back to the row it came from on "back".
  const focusThreadOnSelect = useRef(false);
  const restoreRowId = useRef<string | null>(null);
  // Only consulted below `xl`, where the details column is a sheet rather than
  // a pane. Reset on every selection so a new conversation opens on its
  // transcript, not on the previous one's metadata.
  const [detailsOpen, setDetailsOpen] = useState(false);
  const firstQuery = useRef(true);
  const listGeneration = useRef(0);
  const reviewGeneration = useRef(0);
  const selectedIdRef = useRef(selectedId);
  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  const options = useMemo(() => {
    const unique = (values: Array<string | undefined>) =>
      [...new Set(values.filter((v): v is string => !!v))].sort();
    const loaded = {
      locations: unique(conversations.map((c) => c.metadata.location)),
      cities: unique(conversations.map((c) => c.metadata.city)),
      roles: unique(conversations.map((c) => c.metadata.userRole)),
      languages: unique(conversations.map((c) => c.metadata.language)),
      workflows: unique(conversations.flatMap((c) => c.flowNames)),
    };
    return facets ?? loaded;
  }, [conversations, facets]);

  useEffect(() => {
    if (firstQuery.current) {
      firstQuery.current = false;
      return;
    }
    const generation = ++listGeneration.current;
    let cancelled = false;
    const timeout = window.setTimeout(async () => {
      setLoadingList(true);
      try {
        const page = await getInboxPageAction(
          await withPendingReviews(
            inboxQueryFromFilters({ ...filters, search: deferredSearch }, { limit: 50 }),
            filters.review,
          ),
        );
        if (cancelled || generation !== listGeneration.current) return;
        setConversations((current) => {
          const selected = current.find(
            (row) => row.id === selectedIdRef.current,
          );
          return selected && !page.conversations.some((row) => row.id === selected.id)
            ? [selected, ...page.conversations]
            : page.conversations;
        });
        setNextCursor(page.nextCursor);
      } catch {
        if (!cancelled && generation === listGeneration.current) {
          toast.error("Could not refresh conversations.");
        }
      } finally {
        if (!cancelled && generation === listGeneration.current) {
          setLoadingList(false);
        }
      }
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [filters, deferredSearch]);

  async function loadMore() {
    if (!nextCursor || loadingList) return;
    const generation = listGeneration.current;
    setLoadingList(true);
    try {
      const page = await getInboxPageAction(
        await withPendingReviews(
          inboxQueryFromFilters(
            { ...filters, search: deferredSearch },
            { cursor: nextCursor, limit: 50 },
          ),
          filters.review,
        ),
      );
      if (generation !== listGeneration.current) return;
      setConversations((current) => [
        ...current,
        ...page.conversations.filter(
          (row) => !current.some((existing) => existing.id === row.id),
        ),
      ]);
      setNextCursor(page.nextCursor);
    } catch {
      if (generation === listGeneration.current) {
        toast.error("Could not load more conversations.");
      }
    } finally {
      if (generation === listGeneration.current) setLoadingList(false);
    }
  }

  async function loadFacets() {
    if (facets || loadingFacets) return;
    setLoadingFacets(true);
    try {
      setFacets(await getInboxFacetsAction());
    } catch {
      toast.error("Could not load all filter choices.");
    } finally {
      setLoadingFacets(false);
    }
  }

  function toggleFilters() {
    const next = !filtersOpen;
    setFiltersOpen(next);
    if (next) void loadFacets();
  }

  /** Escape and the Close button hand focus back; an outside click keeps its own target. */
  function closeFilters() {
    setFiltersOpen(false);
    filtersTriggerRef.current?.focus();
  }

  // A non-modal popover: focus moves in on open, and a press anywhere outside
  // the panel and its trigger closes it.
  useEffect(() => {
    if (!filtersOpen) return;
    filtersHeadingRef.current?.focus();
    function onPointerDown(event: PointerEvent) {
      if (pointerInFilters.current) {
        pointerInFilters.current = false;
        return;
      }
      if (filtersTriggerRef.current?.contains(event.target as Node)) return;
      setFiltersOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [filtersOpen]);

  // A selected conversation should show even if the current filters would hide
  // it (e.g. when opened via a deep link outside the default date range).
  const selected = conversations.find((c) => c.id === selectedId) ?? null;

  async function toggleLegalHold(conversationId: string, next: boolean) {
    // Optimistic, then reconciled: the sweep runs nightly, so a stale flag for
    // the duration of a failed request is recoverable, and the revert on error
    // keeps the rail honest.
    setLegalHoldPending(true);
    setConversations((current) =>
      current.map((c) => (c.id === conversationId ? { ...c, legalHold: next } : c)),
    );
    try {
      await setConversationLegalHoldAction(conversationId, next);
      toast.success(next ? "Legal hold placed" : "Legal hold released");
    } catch {
      setConversations((current) =>
        current.map((c) => (c.id === conversationId ? { ...c, legalHold: !next } : c)),
      );
      toast.error("Could not update the legal hold. Try again.");
    } finally {
      setLegalHoldPending(false);
    }
  }

  /** Placing a hold only protects; releasing one re-arms a deletion, so it asks first. */
  function requestLegalHoldChange(conversation: InboxConversation) {
    if (!conversation.legalHold) {
      void toggleLegalHold(conversation.id, true);
      return;
    }
    confirmDelete({
      title: "Release legal hold?",
      description:
        "This conversation goes back on the deletion schedule. The next retention sweep deletes it if it is older than the retention period.",
      confirmLabel: "Release legal hold",
      onConfirm: () => toggleLegalHold(conversation.id, false),
    });
  }
  // Only the user's own dismissal animates. Switching conversation replaces the
  // whole pane, so animating that exit would delay content the user asked for.
  const { exiting: detailsExiting, beginExit: closeDetails } = useExitTransition(
    () => setDetailsOpen(false),
    200,
  );

  /** The sheet's own dismissal: focus goes back to the button that opened it. */
  function dismissDetails() {
    closeDetails();
    detailsButtonRef.current?.focus();
  }

  useEffect(() => {
    if (detailsOpen) detailsHeadingRef.current?.focus();
  }, [detailsOpen]);

  useEffect(() => {
    if (selectedId && focusThreadOnSelect.current) {
      focusThreadOnSelect.current = false;
      threadHeadingRef.current?.focus();
    }
    if (!selectedId && restoreRowId.current) {
      const id = restoreRowId.current;
      restoreRowId.current = null;
      document
        .querySelector<HTMLElement>(`[data-conversation-row="${CSS.escape(id)}"]`)
        ?.focus();
    }
  }, [selectedId]);

  async function loadConversation(id: string) {
    const generation = ++reviewGeneration.current;
    selectedIdRef.current = id;
    setSelectedId(id);
    // The open conversation lives in the address bar, so a reload or a copied
    // link lands on it. replaceState, not the router: page.tsx reads the same
    // param, and a navigation would refetch the page to learn nothing new.
    replaceConversationParam(id);
    setDetailsOpen(false);
    setMessages(null);
    setTranscriptError(false);
    setLinks([]);
    setVerdicts([]);
    setReviews([]);
    try {
      const review = await getInboxConversationReviewAction(id);
      if (generation !== reviewGeneration.current) return;
      applyReview(review);
    } catch {
      if (generation !== reviewGeneration.current) return;
      setTranscriptError(true);
    }
  }

  /** Shows a fetched review: the transcript and what hangs off it. */
  function applyReview(
    review: Awaited<ReturnType<typeof getInboxConversationReviewAction>>,
  ) {
    setMessages(review.messages);
    setLinks(review.improvementLinks);
    setVerdicts(review.answerVerdicts);
    setReviews(review.reviews);
  }

  function select(conversation: InboxConversation) {
    // Only where selecting hides the list; at `lg` the row keeps focus.
    focusThreadOnSelect.current = !window.matchMedia(LG_QUERY).matches;
    void loadConversation(conversation.id);
  }

  // Load the transcript once when arriving via a deep link. selectedId is
  // already seeded from the URL, so this only fetches (state is set in the
  // async callbacks, which is the sanctioned effect pattern).
  useEffect(() => {
    if (!initialId) return;
    const generation = ++reviewGeneration.current;
    let cancelled = false;
    getInboxConversationReviewAction(initialId).then((review) => {
      if (cancelled || generation !== reviewGeneration.current) return;
      applyReview(review);
    }).catch(() => {
      if (cancelled || generation !== reviewGeneration.current) return;
      setTranscriptError(true);
    });
    return () => {
      cancelled = true;
    };
    // Runs once on mount for the deep-linked conversation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refreshLinks() {
    if (!selectedId) return;
    try {
      // Together, and applied together: two independent reads, and failing one
      // of them must not leave the pane showing a refreshed half beside a stale
      // one — which is what the comment below has always claimed.
      const [links, reviews] = await Promise.all([
        listConversationImprovementLinksAction(selectedId),
        listConversationReviewsAction(selectedId),
      ]);
      setLinks(links);
      setReviews(reviews);
    } catch {
      // The stale chips stay; the toast says they may be behind.
      toast.error("Could not refresh the improvement links. Reload to see them.");
    }
  }

  async function setFeedback(messageId: string, reaction: FeedbackReactionId | null) {
    const before = messages?.find((m) => m.id === messageId);
    const feedback = feedbackReactionScore(reaction);
    setMessages(
      (prev) =>
        prev?.map((m) =>
          m.id === messageId ? { ...m, feedback, feedbackReaction: reaction } : m
        ) ?? prev
    );
    try {
      await setMessageFeedbackAction(messageId, feedback, reaction);
    } catch {
      if (before) {
        setMessages(
          (prev) =>
            prev?.map((m) =>
              m.id === messageId
                ? { ...m, feedback: before.feedback, feedbackReaction: before.feedbackReaction }
                : m
            ) ?? prev
        );
      }
      toast.error("Could not save the feedback. Try again.");
    }
  }

  /**
   * The two filtered exports. `json` is the reference-parity export (#561):
   * 29-field Conversation records with their full transcripts and a serialized
   * `AgenticTrace` per message, assembled server-side because the transcripts
   * are not loaded in the browser and the reasoning gate has to be enforced
   * rather than requested. `csv` is the flat conversation list: one row per
   * Conversation, no transcripts.
   */
  async function exportFiltered(kind: "csv" | "json") {
    setExporting(true);
    try {
      const query = inboxQueryFromFilters({ ...filters, search });
      let result: { truncated: boolean; limit: number };
      if (kind === "json") {
        const json = await exportInboxConversationsAction(query);
        downloadFile(
          JSON.stringify(json.rows, null, 2),
          "application/json",
          "conversations.json"
        );
        result = json;
      } else {
        const csv = await exportInboxSummariesAction(query);
        downloadFile(
          conversationSummaryCsv(csv.conversations),
          "text/csv",
          "conversations.csv"
        );
        result = csv;
      }
      if (result.truncated) {
        toast.warning(
          `Exported the first ${result.limit} matching conversations. Narrow the filters to export another window.`
        );
      }
    } catch {
      toast.error("Export failed, please try again.");
    } finally {
      setExporting(false);
    }
  }

  /**
   * PDF export of the open transcript (#561). The browser's own print pipeline
   * does the rendering, which is what makes a long transcript paginate instead of
   * being cut off; a hidden iframe keeps the Inbox on screen behind the dialog.
   */
  function printTranscript() {
    if (!selected || !messages) return;
    const frame = document.createElement("iframe");
    frame.setAttribute("aria-hidden", "true");
    frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
    document.body.appendChild(frame);
    // afterprint is the normal cleanup. The timer is the net for a browser that
    // never fires it, long enough that nobody is still in the dialog.
    const fallback = window.setTimeout(() => frame.remove(), 10 * 60_000);
    const cleanup = () => {
      window.clearTimeout(fallback);
      frame.remove();
    };
    try {
      const doc = frame.contentDocument;
      const win = frame.contentWindow;
      if (!doc || !win) throw new Error("No print frame");
      doc.open();
      doc.write(transcriptDocument({ conversation: selected, messages }));
      doc.close();
      // The frame must outlive print(), the dialog is modal but asynchronous,
      // and removing the frame while it is open cancels the job.
      win.addEventListener("afterprint", cleanup);
      win.focus();
      win.print();
    } catch {
      cleanup();
      toast.error("Could not open the print view. Try again.");
    }
  }

  const meta = selected?.metadata;
  const studyReplies = useMemo(
    () => (messages ?? []).map((message) => message.content as ChatReplyPart[]),
    [messages],
  );

  return (
    <StudyProvider replies={studyReplies}>
    <div className="flex h-full flex-col">
      {/* Header */}
      <header className="relative flex shrink-0 flex-wrap items-center gap-3 px-4 pt-5 pb-3 sm:px-6">
        <h1
          className="text-2xl font-bold tracking-tight"
          data-testid="inbox-heading"
        >
          <RollInText text="Inbox" />
        </h1>
        {canOverseeChannels && (
          <Link
            href="/inbox/channels"
            className="text-muted-foreground hover:text-foreground text-sm"
          >
            Groups
          </Link>
        )}
        {/* On a phone the search field takes the whole second row and the two
            menus sit beside it; from `sm` up the group returns to one row
            pinned right. */}
        <div className="flex w-full items-center gap-2 sm:ml-auto sm:w-auto">
          <div className="relative min-w-0 flex-1 sm:flex-none">
            <Search className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search conversations…"
              aria-label="Search conversations"
              type="search"
              autoComplete="off"
              className="h-10 w-full rounded-lg pl-9 sm:w-64"
            />
          </div>
          <Button
            ref={filtersTriggerRef}
            variant="outline"
            aria-label="Filters"
            aria-expanded={filtersOpen}
            aria-controls={filtersOpen ? filtersPanelId : undefined}
            className="h-10 shrink-0 rounded-lg px-3 sm:px-4"
            onClick={toggleFilters}
          >
            <ListFilter className="size-4" />{" "}
            <span className="hidden sm:inline">Filters</span>
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="outline"
                  aria-label={exporting ? "Exporting…" : "Exports"}
                  className="h-10 shrink-0 rounded-lg px-3 sm:px-4"
                />
              }
              disabled={exporting}
            >
              <Download className="size-4" />{" "}
              <span className="hidden sm:inline">
                <RollInText text={exporting ? "Exporting…" : "Exports"} />
              </span>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={() => void exportFiltered("csv")}
                disabled={exporting}
              >
                Export filtered CSV
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => void exportFiltered("json")}
                disabled={exporting}
              >
                {exporting
                  ? "Preparing export…"
                  : "Export filtered JSON with transcripts"}
              </DropdownMenuItem>
              {selected && (
                <DropdownMenuItem onClick={printTranscript} disabled={!messages}>
                  Export this transcript as PDF
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Filters panel */}
        {filtersOpen && (
          <div
            id={filtersPanelId}
            role="dialog"
            aria-labelledby={`${filtersPanelId}-title`}
            onPointerDown={() => {
              pointerInFilters.current = true;
            }}
            onKeyDown={(event) => {
              // Only a key pressed in the panel itself: an Escape inside an
              // open Select or date popup closes that popup, not the panel.
              if (
                event.key === "Escape" &&
                event.currentTarget.contains(event.target as Node)
              ) {
                event.stopPropagation();
                closeFilters();
              }
            }}
            className="absolute top-full right-4 left-4 z-30 max-h-[70vh] overflow-y-auto overscroll-contain rounded-xl border bg-popover p-5 shadow-xl sm:right-6 sm:left-auto sm:w-96"
          >
            <div className="mb-4 flex items-center justify-between">
              <h2
                id={`${filtersPanelId}-title`}
                ref={filtersHeadingRef}
                tabIndex={-1}
                className="text-lg font-semibold outline-none"
              >
                Filters
              </h2>
              <button
                type="button"
                onClick={closeFilters}
                className="text-primary hover:bg-primary/10 focus-visible:ring-ring flex items-center gap-1 rounded-md px-2 py-1 text-sm font-semibold transition-colors focus-visible:ring-2 focus-visible:outline-none"
              >
                <X aria-hidden="true" className="size-4" /> Close
              </button>
            </div>

            <div className="space-y-4">
              {loadingFacets && (
                <p className="text-muted-foreground text-xs">
                  Loading all filter choices…
                </p>
              )}
              <p className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
                User information
              </p>
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium">User Info</span>
                <div className="relative">
                  <Search className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
                  <input
                    name="user-info"
                    autoComplete="off"
                    value={filters.userInfo}
                    onChange={(e) =>
                      setFilters({ ...filters, userInfo: e.target.value })
                    }
                    placeholder="Type user info"
                    className={`${FIELD_CLASS} pl-9`}
                  />
                </div>
              </label>
              <FilterSelect
                label="Locations"
                value={filters.location}
                placeholder="All Locations"
                options={options.locations.map((v) => ({ value: v, label: v }))}
                onChange={(location) => setFilters({ ...filters, location })}
                allowCustom
              />
              <FilterSelect
                label="Cities"
                value={filters.city}
                placeholder="All Cities"
                options={options.cities.map((v) => ({ value: v, label: v }))}
                onChange={(city) => setFilters({ ...filters, city })}
                allowCustom
              />
              <FilterSelect
                label="Roles"
                value={filters.role}
                placeholder="All Roles"
                options={options.roles.map((v) => ({ value: v, label: v }))}
                onChange={(role) => setFilters({ ...filters, role })}
                allowCustom
              />

              <p className="text-muted-foreground pt-2 text-xs font-semibold tracking-wider uppercase">
                Conversation
              </p>
              <div>
                <span className="mb-1.5 block text-sm font-medium">Date Range</span>
                <div className="flex items-center gap-2">
                  <DateField
                    value={filters.from}
                    onChange={(from) => setFilters({ ...filters, from })}
                    label="From date"
                    className="h-10 flex-1"
                  />
                  <span aria-hidden="true" className="text-muted-foreground">
                    –
                  </span>
                  <DateField
                    value={filters.to}
                    onChange={(to) => setFilters({ ...filters, to })}
                    label="To date"
                    className="h-10 flex-1"
                  />
                </div>
              </div>
              <FilterSelect
                label="Assistants"
                value={filters.assistantId}
                placeholder="All Assistants"
                options={assistants.map((a) => ({ value: a.id, label: a.title }))}
                onChange={(assistantId) => setFilters({ ...filters, assistantId })}
              />
              <FilterSelect
                label="Languages"
                value={filters.language}
                placeholder="All Languages"
                options={options.languages.map((v) => ({ value: v, label: v }))}
                onChange={(language) => setFilters({ ...filters, language })}
                allowCustom
              />
              <FilterSelect
                label="Workflows"
                value={filters.workflow}
                placeholder="All Workflows"
                options={options.workflows.map((v) => ({ value: v, label: v }))}
                onChange={(workflow) => setFilters({ ...filters, workflow })}
                allowCustom
              />
              <label className="block">
                <span className="mb-1 block text-sm font-medium">Conversation IDs</span>
                <span className="text-muted-foreground mb-1.5 block text-xs">
                  Separate IDs with commas or spaces.
                </span>
                <input
                  name="conversation-ids"
                  autoComplete="off"
                  spellCheck={false}
                  value={filters.conversationIds}
                  onChange={(e) =>
                    setFilters({ ...filters, conversationIds: e.target.value })
                  }
                  placeholder="Paste IDs…"
                  className={FIELD_CLASS}
                />
              </label>

              <p className="text-muted-foreground pt-2 text-xs font-semibold tracking-wider uppercase">
                Feedback &amp; escalation
              </p>
              <FilterSelect
                label="Feedback"
                value={filters.feedback}
                placeholder="All Feedbacks"
                options={[
                  { value: "up", label: "Positive 🥰" },
                  { value: "neutral", label: "Neutral 😶‍🌫️" },
                  { value: "down", label: "Negative 🤬" },
                ]}
                onChange={(feedback) =>
                  setFilters({ ...filters, feedback: feedback as InboxFilters["feedback"] })
                }
              />
              <FilterSelect
                label="Escalation"
                value={filters.escalation}
                placeholder="All Escalations"
                options={[
                  { value: "escalated", label: "Escalated" },
                  { value: "not_escalated", label: "Not escalated" },
                ]}
                onChange={(escalation) =>
                  setFilters({
                    ...filters,
                    escalation: escalation as InboxFilters["escalation"],
                  })
                }
              />
              <FilterSelect
                label="Human review"
                value={filters.review}
                placeholder="Any"
                options={[{ value: "pending", label: "Pending reviews" }]}
                onChange={(review) =>
                  setFilters({ ...filters, review: review as InboxFilters["review"] })
                }
              />
              <FilterSelect
                label="Staff conversations"
                value={filters.staff}
                placeholder="Hidden (default)"
                options={[
                  { value: "include", label: "Include staff" },
                  { value: "only", label: "Staff only" },
                ]}
                onChange={(staff) =>
                  setFilters({ ...filters, staff: staff as InboxFilters["staff"] })
                }
              />
              <div className="flex justify-end pt-1">
                <Button
                  variant="ghost"
                  onClick={() => setFilters(defaultInboxFilters())}
                  className="text-sm"
                >
                  Reset filters
                </Button>
              </div>
            </div>
          </div>
        )}
      </header>

      {/* Date range chip */}
      <div className="shrink-0 px-4 pb-3 sm:px-6">
        <span className="text-primary inline-flex items-center gap-1.5 rounded-lg border border-primary/20 bg-primary/5 dark:border-primary/40 dark:bg-primary/15 px-3 py-1.5 text-sm font-medium">
          Date Range:{" "}
          {filters.from ? filterDayLabel(filters.from) : "…"} –{" "}
          {filters.to ? filterDayLabel(filters.to) : "…"}
          <Info aria-hidden="true" className="size-3.5" />
        </span>
      </div>

      <div className="flex min-h-0 flex-1 border-t">
        {/* Conversation log. Three panes need ~1100px to all be usable; below
            `lg` the list and the thread take turns owning the screen, the way
            a phone mail client does, picking a conversation swaps to it and
            "All conversations" comes back. */}
        <aside
          aria-label="Conversations"
          aria-busy={loadingList}
          className={`w-full shrink-0 flex-col overflow-y-auto border-r lg:flex lg:w-72 ${
            selected ? "hidden" : "flex"
          }`}
        >
          <div className="flex items-center gap-2 px-4 py-3">
            <h2 className="text-sm font-semibold">Conversation log</h2>
            {/* The loaded window, not the total: "+" says more pages exist. */}
            <span className="text-muted-foreground text-sm">
              <RollingNumber value={conversations.length} />
              {nextCursor ? "+" : ""}
            </span>
          </div>
          <p role="status" aria-live="polite" className="sr-only">
            {loadingList
              ? "Loading conversations…"
              : `${conversations.length}${nextCursor ? " or more" : ""} ${
                  conversations.length === 1 ? "conversation" : "conversations"
                }`}
          </p>
          <p className="text-muted-foreground px-4 pb-2 text-xs">Latest activity first</p>
          {conversations.length === 0 && (
            <EmptyState
              size="sm"
              title="No conversations"
              description="Nothing matches the current filters."
            />
          )}
          {conversations.map((c) => (
            // A link, so Cmd/Ctrl/middle-click opens the conversation in a new
            // tab; a plain click selects it in place.
            <a
              key={c.id}
              href={conversationHref(c.id)}
              data-conversation-row={c.id}
              aria-current={selectedId === c.id ? "page" : undefined}
              onClick={(event) => {
                if (
                  event.button !== 0 ||
                  event.metaKey ||
                  event.ctrlKey ||
                  event.shiftKey ||
                  event.altKey
                ) {
                  return;
                }
                event.preventDefault();
                select(c);
              }}
              className={`focus-visible:ring-ring flex gap-3 border-b px-4 py-3 text-left transition-colors [contain-intrinsic-size:auto_96px] [content-visibility:auto] focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset ${
                selectedId === c.id ? "bg-primary/5 dark:bg-primary/25" : "hover:bg-muted/50"
              }`}
            >
              <span className="bg-primary/10 text-primary flex size-9 shrink-0 items-center justify-center rounded-full text-xs font-bold">
                {subjectInitials(c)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">
                  {subjectName(c)}
                </span>
                <span className="text-muted-foreground block truncate text-xs">
                  {c.title || "Untitled conversation"}
                </span>
                {/* The assistant spoke first and nobody answered, a nudge, not a
                    conversation. Marked so the queue isn't padded with these. */}
                {c.notificationOnly && (
                  <span className="text-muted-foreground mt-1 mr-1 inline-block max-w-full truncate rounded-full border border-dashed px-2 py-0.5 text-2xs font-medium">
                    Notification only
                  </span>
                )}
                {c.collectionName && (
                  <span className="mt-1 inline-block max-w-full truncate rounded-full border px-2 py-0.5 text-2xs font-medium">
                    {c.collectionName}
                  </span>
                )}
                <span className="text-muted-foreground mt-1 block text-xs">
                  {dayLabel(c.updatedAt)}
                </span>
              </span>
            </a>
          ))}
          {nextCursor && (
            <Button
              variant="ghost"
              className="m-3 shrink-0"
              disabled={loadingList}
              onClick={() => void loadMore()}
            >
              <RollInText text={loadingList ? "Loading…" : "Load more"} />
            </Button>
          )}
        </aside>

        {/* Thread */}
        <section
          aria-label="Transcript"
          className={`min-w-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6 lg:block ${
            selected ? "block" : "hidden"
          }`}
        >
          {!selected && (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
              <span className="text-primary/40 flex size-24 items-center justify-center rounded-full border-2 border-dashed">
                <MessageSquareDashed className="size-10" />
              </span>
              <h3 className="text-xl font-bold">Select a conversation</h3>
              <p className="text-muted-foreground max-w-sm text-sm">
                Pick one from the list to view its details, or use search and
                filters to find specific conversations.
              </p>
            </div>
          )}

          {selected && (
            <div className="space-y-4">
              {/* The two panes the layout drops below `lg`/`xl` need a way
                  back in. Each button disappears exactly where its pane
                  rejoins the flow. */}
              <div className="flex items-center gap-2 xl:hidden">
                <Button
                  variant="outline"
                  size="sm"
                  className="lg:hidden"
                  onClick={() => {
                    restoreRowId.current = selectedId;
                    setSelectedId(null);
                    replaceConversationParam(null);
                  }}
                >
                  <ChevronLeft className="size-4" /> All conversations
                </Button>
                <Button
                  ref={detailsButtonRef}
                  variant="outline"
                  size="sm"
                  className="ml-auto"
                  aria-expanded={detailsOpen}
                  onClick={() => setDetailsOpen(true)}
                >
                  <Info className="size-4" /> Details
                </Button>
              </div>

              <div className="flex items-center gap-3 rounded-xl border px-4 py-3">
                <span className="bg-primary/10 text-primary flex size-10 shrink-0 items-center justify-center rounded-full text-sm font-bold">
                  {subjectInitials(selected)}
                </span>
                <div className="min-w-0 flex-1">
                  <h2
                    ref={threadHeadingRef}
                    tabIndex={-1}
                    className="truncate font-semibold outline-none"
                  >
                    {subjectName(selected)}
                  </h2>
                  <p className="text-muted-foreground truncate text-sm">
                    {selected.metadata.userEmail ?? selected.subjectId}
                    {selected.metadata.userRole ? ` • ${selected.metadata.userRole}` : ""}
                  </p>
                </div>
                {/* A full UUID does not fit beside a name on a phone; the
                    Details pane carries it there. */}
                <Badge
                  variant="outline"
                  translate="no"
                  title={selected.id}
                  className="hidden max-w-[40%] font-mono sm:inline-flex"
                >
                  <span className="truncate">ID {selected.id}</span>
                </Badge>
              </div>

              <p className="text-muted-foreground text-xs font-medium">
                <RollingNumber value={selected.messageCount} />{" "}
                {selected.messageCount === 1 ? "message" : "messages"} •{" "}
                {dayLabel(selected.createdAt)}{" "}
                <span className="ml-1 inline-block h-px w-40 translate-y-[-3px] bg-current opacity-30" />
              </p>

              {messages === null && !transcriptError && (
                <p role="status" className="text-muted-foreground animate-pulse text-sm">
                  Loading messages…
                </p>
              )}

              {transcriptError && (
                <div role="alert" className="flex flex-col items-start gap-2 rounded-xl border border-dashed px-4 py-3 text-sm">
                  <p className="font-medium">Could not load this conversation</p>
                  <p className="text-muted-foreground">
                    Check your connection, then try again.
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void loadConversation(selected.id)}
                  >
                    Retry
                  </Button>
                </div>
              )}

              {messages?.length === 0 && (
                <EmptyState
                  size="sm"
                  title="No messages"
                  description="This conversation has no stored messages."
                />
              )}

              {messages?.map((m) => {
                if (m.role === "user") {
                  // Visitor messages sit on the right, assistant replies on the
                  // left, the convention every messaging app trains readers on.
                  return (
                    <div
                      key={m.id}
                      className="flex flex-row-reverse items-start gap-2.5 [contain-intrinsic-size:auto_64px] [content-visibility:auto]"
                    >
                      <span className="bg-primary/10 text-primary flex size-8 shrink-0 items-center justify-center rounded-full text-2xs font-bold">
                        {subjectInitials(selected)}
                      </span>
                      <div className="flex min-w-0 flex-1 flex-col items-end">
                        <div className="bg-primary text-primary-foreground max-w-[75%] rounded-2xl rounded-tr-sm px-4 py-2.5 text-sm leading-relaxed [overflow-wrap:anywhere] whitespace-pre-wrap">
                          {messageText(m.content)}
                        </div>
                        <MessageTime iso={m.createdAt} />
                      </div>
                    </div>
                  );
                }
                // How this answer was reached, replayed from the persisted
                // Thinking Steps through the same panel the live chat renders.
                const trace = visibleTraceSteps(m.trace, { canViewReasoning });
                return (
                  <div key={m.id} className="space-y-2 pl-10">
                    {m.flowName && (
                      <WorkflowMarker
                        icon={<CirclePlay className="size-3.5 text-emerald-500" />}
                      >
                        Workflow triggered: {m.flowName}
                      </WorkflowMarker>
                    )}
                    {/* Off-screen turns skip layout and paint. Only the content:
                        containment clips overflow, and the reaction menu in the
                        row below opens outside its box. The side padding keeps
                        a child's focus ring inside the clip. */}
                    <div className="-mx-1 space-y-2 px-1 [contain-intrinsic-size:auto_120px] [content-visibility:auto]">
                      {trace && (
                        <ThinkingPanel
                          steps={trace.steps}
                          phase="done"
                          searchCount={trace.searchCount}
                          active={false}
                          summaryLabel={storedTraceLabel(trace)}
                          note={traceNote(trace)}
                        />
                      )}
                      {trace?.preflight && <PreflightRecordPanel record={trace.preflight} />}
                      {(m.content as ChatReplyPart[]).map((part, i) => (
                        <MessagePart key={i} part={part} />
                      ))}
                    </div>
                    <div className="flex flex-wrap items-center gap-2 pt-0.5">
                      {canEdit && (
                        <button
                          type="button"
                          onClick={() => setImproveMessageId(m.id)}
                          className="text-primary hover:bg-primary/15 bg-primary/10 focus-visible:ring-ring inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors focus-visible:ring-2 focus-visible:outline-none"
                        >
                          <WandSparkles aria-hidden="true" className="size-3.5" /> Improve Answer
                        </button>
                      )}
                      {(m.content as ChatReplyPart[]).some(
                        (p) => p.type === "text" && p.action === "refusal"
                      ) && (
                        <span className="inline-flex items-center gap-1.5 rounded-md border border-amber-400 px-2 py-1 text-xs font-medium text-amber-700 dark:border-amber-600 dark:text-amber-400">
                          <ShieldAlert className="size-3.5" /> Refusal
                        </span>
                      )}
                      {terminalBadge(trace?.terminal) && (
                        <span className="text-muted-foreground inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium">
                          {terminalBadge(trace?.terminal)}
                        </span>
                      )}
                      {verdicts
                        .filter((v) => v.messageId === m.id)
                        .map((v) => (
                          <span
                            key={`verdict-${v.messageId}`}
                            title={v.reason}
                            className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium ${
                              v.verdict === "pass"
                                ? "text-emerald-600"
                                : "text-destructive"
                            }`}
                          >
                            {v.verdict === "pass" ? (
                              <ShieldCheck className="size-3.5" />
                            ) : (
                              <ShieldAlert className="size-3.5" />
                            )}
                            {v.verdict === "pass"
                              ? "Verified"
                              : "Failed verification"}
                            {/* The tooltip is pointer-only; this is the same reason, read aloud. */}
                            {v.reason && <span className="sr-only">: {v.reason}</span>}
                          </span>
                        ))}
                      {links
                        .filter((l) => l.messageId === m.id)
                        .map((l) => (
                          <Link
                            key={l.improvementId}
                            href={`/improvements/${l.improvementId}`}
                            className="hover:bg-muted inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium transition-colors"
                          >
                            <span className="font-mono">IMP-{l.seq}</span>
                            <span className="max-w-40 truncate">{l.title}</span>
                            <ExternalLink className="text-muted-foreground size-3" />
                          </Link>
                        ))}
                      <div className="ml-auto flex items-center gap-2">
                        {m.feedbackReaction ? (
                          <span className="inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-xs">
                            <span aria-hidden>{feedbackReactionById(m.feedbackReaction)?.emoji}</span>
                            <RollInText
                              text={feedbackReactionById(m.feedbackReaction)?.label ?? ""}
                            />
                          </span>
                        ) : m.feedback !== 0 ? (
                          <span className="text-muted-foreground text-xs">
                            {m.feedback === 1 ? "Positive feedback" : "Negative feedback"}
                          </span>
                        ) : null}
                        <EmojiFeedback
                          value={m.feedbackReaction ?? null}
                          onChange={(reaction) => setFeedback(m.id, reaction)}
                        />
                      </div>
                    </div>
                    <MessageTime iso={m.createdAt} />
                    {m.flowName && (
                      <WorkflowMarker
                        icon={<SquareCheck className="size-3.5 text-red-400" />}
                      >
                        Workflow ended: {m.flowName}
                      </WorkflowMarker>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Details, docked as a third column only where all three panes fit
            (`xl`), and reachable everywhere else through the thread's
            "Details" button, which opens this same content as a sheet. */}
        {selected && (
          <aside
            aria-label="Details"
            onKeyDown={
              detailsOpen
                ? (event) => {
                    if (event.key !== "Escape") return;
                    event.stopPropagation();
                    dismissDetails();
                  }
                : undefined
            }
            className={
              detailsOpen
                ? `bg-background fixed inset-y-0 right-0 z-50 w-[22rem] max-w-[88vw] space-y-4 overflow-y-auto overscroll-contain border-l p-4 shadow-2xl duration-200 xl:static xl:z-auto xl:w-80 xl:max-w-none xl:shrink-0 xl:animate-none xl:bg-muted/40 xl:shadow-none ${
                    // Leaves toward the edge it arrived from. It used to slide
                    // in from the right and then switch to `hidden`, so the
                    // sheet's exit contradicted its entrance.
                    detailsExiting
                      ? "animate-out slide-out-to-right"
                      : "animate-in slide-in-from-right"
                  }`
                : "bg-muted/40 hidden w-80 shrink-0 space-y-4 overflow-y-auto border-l p-4 xl:block"
            }
          >
            <div className="flex items-center justify-between xl:hidden">
              <h2
                ref={detailsHeadingRef}
                tabIndex={-1}
                className="text-sm font-semibold outline-none"
              >
                Conversation
              </h2>
              <button
                type="button"
                aria-label="Close details"
                onClick={dismissDetails}
                className="text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-ring flex size-9 items-center justify-center rounded-lg transition-colors focus-visible:ring-2 focus-visible:outline-none"
              >
                <X aria-hidden="true" className="size-4" />
              </button>
            </div>
            <Card size="sm" className="gap-3 p-4">
              <h3 className="font-semibold">Conversation details</h3>
              <DetailRow label="Assistant" value={selected.assistantTitle} />
              <div className="grid grid-cols-2 gap-3">
                <DetailRow
                  label="Timestamp"
                  value={formatDateTime(selected.createdAt)}
                />
                <DetailRow label="Course" value={selected.collectionName} />
              </div>
              <DetailRow label="Course ID" value={selected.collectionId} />
              <DetailRow label="Conversation ID" value={selected.id} />
            </Card>

            <Card size="sm" className="gap-3 p-4">
              <h3 className="font-semibold">Session</h3>
              {selected.subjectType === "sso" && (
                <DetailRow
                  label="Signed-in user"
                  value={meta?.ssoClaimValue ?? selected.subjectId}
                />
              )}
              <DetailRow label="Launch URL" value={meta?.launchUrl} />
              <div className="grid grid-cols-2 gap-3">
                <DetailRow label="IP address" value={meta?.ip} />
                <DetailRow label="OS" value={meta?.os} />
                <DetailRow label="Browser" value={meta?.browser} />
                <DetailRow label="Language" value={meta?.language} />
                <DetailRow label="Location" value={meta?.location} />
                <DetailRow label="City" value={meta?.city} />
                <DetailRow label="Resolution" value={meta?.resolution} />
              </div>
            </Card>

            <Card size="sm" className="gap-3 p-4">
              <h3 className="font-semibold">Escalation</h3>
              <DetailRow
                label="Status"
                value={meta?.escalated ? "Escalated" : "Not escalated"}
              />
              {meta?.escalated && (
                <div className="grid grid-cols-2 gap-3">
                  <DetailRow label="Help desk" value={meta.escalationHelpDesk} />
                  <DetailRow label="Option" value={meta.escalationOption} />
                  {meta.escalationRecommendedHelpDesk && (
                    <DetailRow
                      label="Recommended"
                      value={`${meta.escalationRecommendedHelpDesk}${meta.escalationFollowedRecommendation ? " (followed)" : " (not followed)"}`}
                    />
                  )}
                </div>
              )}
              {meta?.feedbackText && (
                <div>
                  <p className="text-muted-foreground text-xs">User feedback</p>
                  <p className="text-sm whitespace-pre-wrap [overflow-wrap:anywhere]">{meta.feedbackText}</p>
                </div>
              )}
            </Card>

            {reviews.length > 0 && (
              <Card size="sm" className="gap-3 p-4">
                <h3 className="font-semibold">Human review</h3>
                {reviews.map((review) => (
                  <div key={review.id} className="space-y-1">
                    <DetailRow
                      label={review.title}
                      value={`${reviewDecisionLabel(review)}${review.decidedAt ? ` · ${formatDateTime(review.decidedAt)}` : ""}`}
                    />
                    {review.decision && Object.keys(review.decision).length > 0 && (
                      <div className="grid grid-cols-2 gap-3">
                        {review.inputs.map((field) => (
                          <DetailRow
                            key={field.id}
                            label={field.label}
                            value={review.decision?.[field.id] ?? ""}
                          />
                        ))}
                      </div>
                    )}
                    {review.status === "pending" && (
                      <Link
                        href={`/reviews/${review.id}`}
                        className="text-primary text-sm hover:underline"
                      >
                        Open the decision page →
                      </Link>
                    )}
                  </div>
                ))}
              </Card>
            )}

            <Card size="sm" className="gap-3 p-4">
              <h3 className="font-semibold">Retention</h3>
              <div aria-live="polite">
                <DetailRow
                  label="Legal hold"
                  value={
                    selected.legalHold
                      ? "Held: the retention sweep skips this conversation"
                      : "Not held"
                  }
                />
              </div>
              {canManageRetention && (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-fit"
                  disabled={legalHoldPending}
                  onClick={() => requestLegalHoldChange(selected)}
                >
                  <RollInText
                    text={selected.legalHold ? "Release legal hold" : "Place legal hold"}
                  />
                </Button>
              )}
            </Card>
          </aside>
        )}
      </div>

      <ImproveAnswerDialog
        messageId={improveMessageId}
        onClose={() => setImproveMessageId(null)}
        onChanged={refreshLinks}
      />
      {confirmDeleteModal}
    </div>
    </StudyProvider>
  );
}
