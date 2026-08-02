"use client";

import { Link } from "@/components/ui/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type {
  AnswerVerdict,
  ImprovementMessageLink,
  InboxConversation,
  StoredMessage,
} from "@agent-hub/core";
import { isoDay, messageText } from "@agent-hub/core";

import type { ChatReplyPart } from "@agent-hub/agent/client";
import {
  Calendar as CalendarIcon,
  CirclePlay,
  Download,
  ExternalLink,
  Headphones,
  HelpCircle,
  Info,
  ListFilter,
  MessageSquareDashed,
  Search,
  ShieldAlert,
  ShieldCheck,
  SquareCheck,
  ThumbsDown,
  ThumbsUp,
  WandSparkles,
  X,
} from "lucide-react";
import { toast } from "@/lib/toast";
import {
  exportInboxConversationsAction,
  getConversationMessagesAction,
  listConversationAnswerVerdictsAction,
  listConversationImprovementLinksAction,
  setMessageFeedbackAction,
} from "@/app/actions";
import { transcriptDocument } from "@/lib/inbox/transcript-print";
import { ImproveAnswerDialog } from "@/components/inbox/improve-answer-dialog";
import { CitationList } from "@/components/chat/citation-list";
import { ProgressLine } from "@/components/chat/progress-line";
import { ChatMarkdown } from "@/components/chat/chat-markdown";
import { ThinkingPanel } from "@/components/chat/thinking-panel";
import {
  storedTraceLabel,
  terminalBadge,
  visibleTraceSteps,
} from "@/components/chat/stored-trace";
import { Badge } from "@agent-hub/ui";
import { Button } from "@agent-hub/ui";
import { Calendar } from "@agent-hub/ui";
import { Card } from "@agent-hub/ui";
import { Popover, PopoverContent, PopoverTrigger } from "@agent-hub/ui";
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
import { formatDateTime } from "@/lib/format";

interface AssistantOption {
  id: string;
  title: string;
}

interface Filters {
  userInfo: string;
  location: string;
  city: string;
  role: string;
  from: string;
  to: string;
  assistantId: string;
  helpDesk: string;
  language: string;
  workflow: string;
  conversationIds: string;
  feedback: "" | "up" | "down";
  escalation: "" | "escalated" | "not_escalated";
}

function defaultFilters(): Filters {
  const to = new Date();
  const from = new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
  return {
    userInfo: "",
    location: "",
    city: "",
    role: "",
    from: isoDay(from),
    to: isoDay(to),
    assistantId: "",
    helpDesk: "",
    language: "",
    workflow: "",
    conversationIds: "",
    feedback: "",
    escalation: "",
  };
}

function dayLabel(iso: string): string {
  return new Date(iso).toDateString();
}

/**
 * Per-message time in the transcript. The conversation header already carries
 * the date, so a turn only needs its clock time — and reviewing a transcript
 * means reading the gaps between turns.
 */
function MessageTime({ iso }: { iso: string }) {
  return (
    <time
      dateTime={iso}
      title={formatDateTime(iso)}
      className="text-muted-foreground/70 mt-1 block text-[11px]"
    >
      {new Date(iso).toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
      })}
    </time>
  );
}

/**
 * The Thinking panel's footer caveat. Says out loud when the stored trace is
 * not the whole turn — reasoning withheld by the Role gate, or steps the
 * runtime clipped on write — so a short panel is never mistaken for a turn that
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
function DateField({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (iso: string) => void;
  className?: string;
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
            className={`justify-start px-3 font-normal data-[empty=true]:text-muted-foreground ${className ?? ""}`}
          />
        }
      >
        <CalendarIcon className="size-4" />
        {selected ? dayLabel(value) : <span>Pick a date</span>}
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

function subjectName(c: InboxConversation): string {
  if (c.metadata.userName) return c.metadata.userName;
  if (c.metadata.userEmail) return c.metadata.userEmail.split("@")[0];
  return c.subjectType === "member" ? "Member" : "Visitor";
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

const FIELD_CLASS =
  "h-10 w-full rounded-lg border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring/50";

function FilterSelect({
  label,
  value,
  placeholder,
  options,
  onChange,
}: {
  label: string;
  value: string;
  placeholder: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium">{label}</span>
      <Select value={value} onValueChange={(v) => onChange(v as string)}>
        <SelectTrigger>
          <SelectValue>
            {(v: string) => options.find((o) => o.value === v)?.label || placeholder}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="">{placeholder}</SelectItem>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
}

function DetailRow({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="min-w-0">
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className="truncate text-sm" title={value ?? undefined}>
        {value || "—"}
      </p>
    </div>
  );
}

function MessagePart({ part }: { part: ChatReplyPart }) {
  if (part.type === "text") {
    return <ChatMarkdown text={part.text} className="max-w-[85%] text-sm" />;
  }
  if (part.type === "progress") {
    // The narration the Visitor watched stream, kept as its own part so the
    // transcript shows exactly what they saw — and stays distinguishable from
    // the answer itself (#560).
    return <ProgressLine text={part.text} className="max-w-[85%]" />;
  }
  if (part.type === "notification") {
    // A proactive nudge: the assistant spoke first, so the transcript marks it
    // as such rather than showing it as an answer to something.
    return (
      <div className="max-w-[85%] space-y-1 rounded-2xl border-l-2 bg-muted/50 px-3.5 py-3 text-sm">
        <p className="text-muted-foreground text-xs font-medium uppercase">
          Notification
        </p>
        {part.title && <p className="font-medium">{part.title}</p>}
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
        <p className="mt-1.5">{part.question}</p>
        {part.found && part.found.length > 0 && (
          <div className="text-muted-foreground mt-2 text-xs">
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
  if (part.type === "help_desk") {
    return (
      <div className="flex max-w-[85%] items-center gap-3 rounded-2xl border px-3.5 py-3">
        <span className="bg-primary/10 text-primary flex size-8 shrink-0 items-center justify-center rounded-full">
          <Headphones className="size-4" />
        </span>
        <p className="text-sm font-medium">{part.label}</p>
      </div>
    );
  }
  if (part.type === "button") {
    return (
      <a
        href={part.url}
        target="_blank"
        rel="noopener noreferrer"
        className="bg-primary inline-flex max-w-[85%] items-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold text-white"
      >
        {part.label}
        <ExternalLink className="size-3" />
      </a>
    );
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
            className="border-primary/30 text-primary rounded-full border px-3 py-1 text-xs font-medium"
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
  conversations,
  assistants,
  canEdit = false,
  canViewReasoning = false,
}: {
  conversations: InboxConversation[];
  assistants: AssistantOption[];
  canEdit?: boolean;
  /** Admins and above see the model's own reasoning in the trace (#557). */
  canViewReasoning?: boolean;
}) {
  const searchParams = useSearchParams();
  // Deep link from an improvement's "View message in conversation context".
  const requestedId = searchParams.get("conversation");
  const initialId =
    requestedId && conversations.some((c) => c.id === requestedId)
      ? requestedId
      : null;

  const [search, setSearch] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filters, setFilters] = useState<Filters>(defaultFilters);
  const [selectedId, setSelectedId] = useState<string | null>(initialId);
  const [messages, setMessages] = useState<StoredMessage[] | null>(null);
  const [links, setLinks] = useState<ImprovementMessageLink[]>([]);
  const [verdicts, setVerdicts] = useState<AnswerVerdict[]>([]);
  const [improveMessageId, setImproveMessageId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const options = useMemo(() => {
    const unique = (values: Array<string | undefined>) =>
      [...new Set(values.filter((v): v is string => !!v))].sort();
    return {
      locations: unique(conversations.map((c) => c.metadata.location)),
      cities: unique(conversations.map((c) => c.metadata.city)),
      roles: unique(conversations.map((c) => c.metadata.userRole)),
      languages: unique(conversations.map((c) => c.metadata.language)),
      workflows: unique(conversations.flatMap((c) => c.flowNames)),
    };
  }, [conversations]);

  const filtered = useMemo(() => {
    const ids = filters.conversationIds
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    const from = filters.from ? new Date(`${filters.from}T00:00:00`) : null;
    const to = filters.to ? new Date(`${filters.to}T23:59:59.999`) : null;
    const needle = search.trim().toLowerCase();
    const userNeedle = filters.userInfo.trim().toLowerCase();

    return conversations.filter((c) => {
      const updated = new Date(c.updatedAt);
      if (from && updated < from) return false;
      if (to && updated > to) return false;
      if (
        needle &&
        ![c.title, c.metadata.userEmail, c.metadata.userName, subjectName(c)]
          .filter(Boolean)
          .some((v) => v!.toLowerCase().includes(needle))
      )
        return false;
      if (
        userNeedle &&
        ![c.metadata.userEmail, c.metadata.userName, c.metadata.userRole, c.subjectId]
          .filter(Boolean)
          .some((v) => v!.toLowerCase().includes(userNeedle))
      )
        return false;
      if (filters.location && c.metadata.location !== filters.location) return false;
      if (filters.city && c.metadata.city !== filters.city) return false;
      if (filters.role && c.metadata.userRole !== filters.role) return false;
      if (filters.assistantId && c.assistantId !== filters.assistantId) return false;
      if (filters.language && c.metadata.language !== filters.language) return false;
      if (filters.workflow && !c.flowNames.includes(filters.workflow)) return false;
      if (ids.length > 0 && !ids.includes(c.id)) return false;
      if (filters.feedback === "up" && c.feedback !== 1) return false;
      if (filters.feedback === "down" && c.feedback !== -1) return false;
      if (filters.escalation === "escalated" && !c.metadata.escalated) return false;
      if (filters.escalation === "not_escalated" && c.metadata.escalated) return false;
      return true;
    });
  }, [conversations, filters, search]);

  // A selected conversation should show even if the current filters would hide
  // it (e.g. when opened via a deep link outside the default date range).
  const selected = conversations.find((c) => c.id === selectedId) ?? null;

  // The transcript must render even when the auxiliary lookups (improvement
  // links, verifier verdicts) fail — e.g. a database that predates their
  // tables — so each fetch settles independently instead of one Promise.all.
  async function loadConversation(id: string) {
    setSelectedId(id);
    setMessages(null);
    setLinks([]);
    setVerdicts([]);
    const [msgs, linkRows, verdictRows] = await Promise.allSettled([
      getConversationMessagesAction(id),
      listConversationImprovementLinksAction(id),
      listConversationAnswerVerdictsAction(id),
    ]);
    setMessages(msgs.status === "fulfilled" ? msgs.value : []);
    setLinks(linkRows.status === "fulfilled" ? linkRows.value : []);
    setVerdicts(verdictRows.status === "fulfilled" ? verdictRows.value : []);
  }

  function select(conversation: InboxConversation) {
    void loadConversation(conversation.id);
  }

  // Load the transcript once when arriving via a deep link. selectedId is
  // already seeded from the URL, so this only fetches (state is set in the
  // async callbacks, which is the sanctioned effect pattern).
  useEffect(() => {
    if (!initialId) return;
    let cancelled = false;
    Promise.allSettled([
      getConversationMessagesAction(initialId),
      listConversationImprovementLinksAction(initialId),
      listConversationAnswerVerdictsAction(initialId),
    ]).then(([msgs, linkRows, verdictRows]) => {
      if (cancelled) return;
      setMessages(msgs.status === "fulfilled" ? msgs.value : []);
      setLinks(linkRows.status === "fulfilled" ? linkRows.value : []);
      setVerdicts(verdictRows.status === "fulfilled" ? verdictRows.value : []);
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
      setLinks(await listConversationImprovementLinksAction(selectedId));
    } catch {
      /* keep stale links on failure */
    }
  }

  async function setFeedback(messageId: string, feedback: -1 | 0 | 1) {
    setMessages(
      (prev) =>
        prev?.map((m) => (m.id === messageId ? { ...m, feedback } : m)) ?? prev
    );
    try {
      await setMessageFeedbackAction(messageId, feedback);
    } catch {
      /* optimistic update stands; refresh on next select */
    }
  }

  function download(body: string, mime: string, filename: string) {
    const url = URL.createObjectURL(new Blob([body], { type: mime }));
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  /**
   * The reference-parity JSON export (#561): 29-field Conversation records with
   * their full transcripts and a serialized `AgenticTrace` per message. Assembled
   * server-side — the transcripts are not loaded in the browser, and the
   * reasoning gate has to be enforced rather than requested.
   */
  async function exportParityJson() {
    setExporting(true);
    try {
      const rows = await exportInboxConversationsAction(filtered.map((c) => c.id));
      download(
        JSON.stringify(rows, null, 2),
        "application/json",
        "conversations.json"
      );
    } catch {
      toast.error("Export failed — please try again.");
    } finally {
      setExporting(false);
    }
  }

  /** The flat conversation-list CSV: one row per Conversation, no transcripts. */
  function exportCsv() {
    const rows = filtered.map((c) => ({
      id: c.id,
      assistant: c.assistantTitle,
      user: c.metadata.userEmail ?? c.subjectId,
      role: c.metadata.userRole ?? "",
      title: c.title,
      collection: c.collectionName ?? "",
      messages: c.messageCount,
      notificationOnly: c.notificationOnly ? "yes" : "no",
      workflows: c.flowNames.join("; "),
      feedback: c.feedback === 1 ? "up" : c.feedback === -1 ? "down" : "",
      escalated: c.metadata.escalated ? "yes" : "no",
      language: c.metadata.language ?? "",
      location: c.metadata.location ?? "",
      city: c.metadata.city ?? "",
      os: c.metadata.os ?? "",
      browser: c.metadata.browser ?? "",
      ip: c.metadata.ip ?? "",
      createdAt: c.createdAt,
    }));
    const headers = Object.keys(rows[0] ?? { id: "" });
    const escape = (v: unknown) => `"${String(v).replaceAll('"', '""')}"`;
    const csv = [
      headers.join(","),
      ...rows.map((r) => headers.map((h) => escape(r[h as keyof typeof r])).join(",")),
    ].join("\n");
    download(csv, "text/csv", "conversations.csv");
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
    const doc = frame.contentDocument;
    if (!doc || !frame.contentWindow) {
      frame.remove();
      toast.error("Could not open the print view.");
      return;
    }
    doc.open();
    doc.write(transcriptDocument({ conversation: selected, messages }));
    doc.close();
    const win = frame.contentWindow;
    // The frame must outlive print() — the dialog is modal but asynchronous, and
    // removing the frame while it is open cancels the job.
    win.addEventListener("afterprint", () => frame.remove());
    win.focus();
    win.print();
  }

  const meta = selected?.metadata;

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <header className="relative flex shrink-0 flex-wrap items-center gap-3 px-6 pt-5 pb-3">
        <h1 className="text-2xl font-bold tracking-tight">Inbox</h1>
        <div className="ml-auto flex items-center gap-2">
          <div className="relative">
            <Search className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search conversations..."
              className="h-10 w-64 rounded-lg pl-9"
            />
          </div>
          <Button
            variant="outline"
            className="h-10 rounded-lg px-4"
            onClick={() => setFiltersOpen((open) => !open)}
          >
            <ListFilter className="size-4" /> Filters
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button variant="outline" className="h-10 rounded-lg px-4" />}
            >
              <Download className="size-4" /> Exports
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={exportCsv}>
                Export CSV ({filtered.length})
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => void exportParityJson()}
                disabled={exporting}
              >
                {exporting
                  ? "Preparing JSON…"
                  : `Export JSON with transcripts (${filtered.length})`}
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
          <div className="absolute top-full right-6 z-30 max-h-[70vh] w-96 overflow-y-auto rounded-xl border bg-popover p-5 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold">Filters</h2>
              <button
                type="button"
                onClick={() => setFiltersOpen(false)}
                className="text-primary flex items-center gap-1 text-sm font-semibold"
              >
                <X className="size-4" /> Close
              </button>
            </div>

            <div className="space-y-4">
              <p className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
                User information
              </p>
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium">User Info</span>
                <div className="relative">
                  <Search className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
                  <input
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
              />
              <FilterSelect
                label="Cities"
                value={filters.city}
                placeholder="All Cities"
                options={options.cities.map((v) => ({ value: v, label: v }))}
                onChange={(city) => setFilters({ ...filters, city })}
              />
              <FilterSelect
                label="Roles"
                value={filters.role}
                placeholder="All Roles"
                options={options.roles.map((v) => ({ value: v, label: v }))}
                onChange={(role) => setFilters({ ...filters, role })}
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
                    className="h-10 flex-1"
                  />
                  <span className="text-muted-foreground">—</span>
                  <DateField
                    value={filters.to}
                    onChange={(to) => setFilters({ ...filters, to })}
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
                label="Help Desks"
                value={filters.helpDesk}
                placeholder="All Help Desks"
                options={[]}
                onChange={(helpDesk) => setFilters({ ...filters, helpDesk })}
              />
              <FilterSelect
                label="Languages"
                value={filters.language}
                placeholder="All Languages"
                options={options.languages.map((v) => ({ value: v, label: v }))}
                onChange={(language) => setFilters({ ...filters, language })}
              />
              <FilterSelect
                label="Workflows"
                value={filters.workflow}
                placeholder="All Workflows"
                options={options.workflows.map((v) => ({ value: v, label: v }))}
                onChange={(workflow) => setFilters({ ...filters, workflow })}
              />
              <label className="block">
                <span className="mb-1 block text-sm font-medium">Conversation IDs</span>
                <span className="text-muted-foreground mb-1.5 block text-xs">
                  Press Enter, comma, or space to add an ID.
                </span>
                <input
                  value={filters.conversationIds}
                  onChange={(e) =>
                    setFilters({ ...filters, conversationIds: e.target.value })
                  }
                  placeholder="Paste IDs"
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
                  { value: "up", label: "Positive 👍" },
                  { value: "down", label: "Negative 👎" },
                ]}
                onChange={(feedback) =>
                  setFilters({ ...filters, feedback: feedback as Filters["feedback"] })
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
                    escalation: escalation as Filters["escalation"],
                  })
                }
              />
              <div className="flex justify-end pt-1">
                <Button
                  variant="ghost"
                  onClick={() => setFilters(defaultFilters())}
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
      <div className="shrink-0 px-6 pb-3">
        <span className="text-primary inline-flex items-center gap-1.5 rounded-lg border border-primary/20 bg-primary/5 dark:border-primary/40 dark:bg-primary/15 px-3 py-1.5 text-sm font-medium">
          Date Range:{" "}
          {filters.from ? dayLabel(`${filters.from}T12:00:00`) : "…"} -{" "}
          {filters.to ? dayLabel(`${filters.to}T12:00:00`) : "…"}
          <Info className="size-3.5" />
        </span>
      </div>

      <div className="flex min-h-0 flex-1 border-t">
        {/* Conversation log */}
        <aside className="flex w-72 shrink-0 flex-col overflow-y-auto border-r">
          <div className="flex items-center gap-2 px-4 py-3">
            <h2 className="text-sm font-semibold">Conversation log</h2>
            <span className="text-muted-foreground text-sm">{filtered.length}</span>
          </div>
          <p className="text-muted-foreground px-4 pb-2 text-xs">Everything else —</p>
          {filtered.length === 0 && (
            <p className="text-muted-foreground px-4 py-8 text-center text-sm">
              No conversations match the current filters.
            </p>
          )}
          {filtered.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => select(c)}
              className={`flex gap-3 border-b px-4 py-3 text-left transition-colors ${
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
                {/* The assistant spoke first and nobody answered — a nudge, not a
                    conversation. Marked so the queue isn't padded with these. */}
                {c.notificationOnly && (
                  <span className="text-muted-foreground mt-1 mr-1 inline-block max-w-full truncate rounded-full border border-dashed px-2 py-0.5 text-[11px] font-medium">
                    Notification only
                  </span>
                )}
                {c.collectionName && (
                  <span className="mt-1 inline-block max-w-full truncate rounded-full border px-2 py-0.5 text-[11px] font-medium">
                    {c.collectionName}
                  </span>
                )}
                <span className="text-muted-foreground mt-1 block text-xs">
                  {dayLabel(c.updatedAt)}
                </span>
              </span>
            </button>
          ))}
        </aside>

        {/* Thread */}
        <section className="min-w-0 flex-1 overflow-y-auto px-6 py-4">
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
              <div className="flex items-center gap-3 rounded-xl border px-4 py-3">
                <span className="bg-primary/10 text-primary flex size-10 shrink-0 items-center justify-center rounded-full text-sm font-bold">
                  {subjectInitials(selected)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{subjectName(selected)}</p>
                  <p className="text-muted-foreground truncate text-sm">
                    {selected.metadata.userEmail ?? selected.subjectId}
                    {selected.metadata.userRole ? ` • ${selected.metadata.userRole}` : ""}
                  </p>
                </div>
                <Badge variant="outline" className="font-mono">
                  ID {selected.id}
                </Badge>
              </div>

              <p className="text-muted-foreground text-xs font-medium">
                {selected.messageCount} Messages •{dayLabel(selected.createdAt)}{" "}
                <span className="ml-1 inline-block h-px w-40 translate-y-[-3px] bg-current opacity-30" />
              </p>

              {messages === null && (
                <p className="text-muted-foreground animate-pulse text-sm">
                  Loading messages…
                </p>
              )}

              {messages?.map((m) => {
                if (m.role === "user") {
                  // Visitor messages sit on the right, assistant replies on the
                  // left — the convention every messaging app trains readers on.
                  return (
                    <div
                      key={m.id}
                      className="flex flex-row-reverse items-start gap-2.5"
                    >
                      <span className="bg-primary/10 text-primary flex size-8 shrink-0 items-center justify-center rounded-full text-[11px] font-bold">
                        {subjectInitials(selected)}
                      </span>
                      <div className="flex min-w-0 flex-1 flex-col items-end">
                        <div className="bg-primary text-primary-foreground max-w-[75%] rounded-2xl rounded-tr-sm px-4 py-2.5 text-sm leading-relaxed">
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
                      <div className="flex items-center justify-center gap-2 py-1">
                        <span className="bg-border h-px flex-1" />
                        <span className="text-muted-foreground inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium">
                          <CirclePlay className="size-3.5 text-emerald-500" />
                          Workflow triggered: {m.flowName}
                        </span>
                        <span className="bg-border h-px flex-1" />
                      </div>
                    )}
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
                    {(m.content as ChatReplyPart[]).map((part, i) => (
                      <MessagePart key={i} part={part} />
                    ))}
                    <div className="flex flex-wrap items-center gap-2 pt-0.5">
                      {canEdit && (
                        <button
                          type="button"
                          onClick={() => setImproveMessageId(m.id)}
                          className="text-primary hover:bg-primary/15 bg-primary/10 inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors"
                        >
                          <WandSparkles className="size-3.5" /> Improve Answer
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
                      <div className="ml-auto flex items-center gap-1">
                        <button
                          type="button"
                          aria-label="Mark helpful"
                          onClick={() => setFeedback(m.id, m.feedback === 1 ? 0 : 1)}
                          className={`hover:bg-muted flex size-7 items-center justify-center rounded-md transition-colors ${
                            m.feedback === 1 ? "text-primary" : "text-muted-foreground"
                          }`}
                        >
                          <ThumbsUp className="size-3.5" />
                        </button>
                        <button
                          type="button"
                          aria-label="Mark not helpful"
                          onClick={() =>
                            setFeedback(m.id, m.feedback === -1 ? 0 : -1)
                          }
                          className={`hover:bg-muted flex size-7 items-center justify-center rounded-md transition-colors ${
                            m.feedback === -1
                              ? "text-destructive"
                              : "text-muted-foreground"
                          }`}
                        >
                          <ThumbsDown className="size-3.5" />
                        </button>
                      </div>
                    </div>
                    <MessageTime iso={m.createdAt} />
                    {m.flowName && (
                      <div className="flex items-center justify-center gap-2 py-1">
                        <span className="bg-border h-px flex-1" />
                        <span className="text-muted-foreground inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium">
                          <SquareCheck className="size-3.5 text-red-400" />
                          Workflow ended: {m.flowName}
                        </span>
                        <span className="bg-border h-px flex-1" />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Details */}
        {selected && (
          <aside className="w-80 shrink-0 space-y-4 overflow-y-auto border-l bg-muted/40 p-4">
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
                </div>
              )}
              {meta?.feedbackText && (
                <div>
                  <p className="text-muted-foreground text-xs">User feedback</p>
                  <p className="text-sm whitespace-pre-wrap">{meta.feedbackText}</p>
                </div>
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
    </div>
  );
}
