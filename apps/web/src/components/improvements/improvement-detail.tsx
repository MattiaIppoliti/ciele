"use client";

import { Link } from "@/components/ui/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type {
  Improvement,
  ImprovementAssociation,
  ImprovementPriority,
  ImprovementProposal,
  ImprovementStatus,
  StoredMessage,
} from "@agent-hub/db";
import { messageText } from "@agent-hub/db";
import {
  Calendar as CalendarIcon,
  Check,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Pencil,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { AnimatedIcon } from "@/components/ui/animated-icon";
import {
  acceptImprovementProposalAction,
  deleteImprovementAction,
  dismissImprovementProposalAction,
  unlinkImprovementMessageAction,
  updateImprovementAction,
} from "@/app/actions";
import { ImproveAnswerDialog } from "@/components/inbox/improve-answer-dialog";
import { Button } from "@agent-hub/ui";
import { Calendar } from "@/components/ui/calendar";
import { Card } from "@agent-hub/ui";
import { Hint } from "@agent-hub/ui";
import { Input } from "@agent-hub/ui";
import {
  Popover,
  PopoverClose,
  PopoverContent,
  PopoverTrigger,
} from "@agent-hub/ui";
import { Textarea } from "@/components/ui/textarea";
import { formatDateTime, formatDay } from "@/lib/format";
import {
  IMPROVEMENT_PRIORITIES,
  IMPROVEMENT_STATUSES,
  improvementKey,
  priorityMeta,
  statusLabel,
} from "@/lib/improvements";
import { memberDisplayName, memberInitials } from "@/lib/members";

interface MemberOption {
  userId: string;
  email: string;
}

function messageSources(
  content: unknown[]
): Array<{ conceptTitle: string; collectionName: string; sourceName: string | null }> {
  for (const p of content) {
    const part = p as {
      type?: string;
      sources?: Array<{
        conceptTitle: string;
        collectionName: string;
        sourceName: string | null;
      }>;
    };
    if (part.type === "sources") return part.sources ?? [];
  }
  return [];
}

function DetailRow({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className="truncate text-sm" title={value ?? undefined}>
        {value || "Unknown"}
      </span>
    </div>
  );
}

/** Left-labelled row whose value is a popover trigger pill. */
function FieldPill({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <span className="text-muted-foreground text-sm">{label}</span>
      {children}
    </div>
  );
}

const PILL =
  "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors hover:bg-muted disabled:opacity-60";

export function ImprovementDetail({
  improvement,
  associations,
  members,
  proposal,
  canEdit,
}: {
  improvement: Improvement;
  associations: ImprovementAssociation[];
  members: MemberOption[];
  proposal: ImprovementProposal | null;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  const [title, setTitle] = useState(improvement.title);
  const [editingTitle, setEditingTitle] = useState(false);
  const [description, setDescription] = useState(improvement.description);
  const [status, setStatus] = useState(improvement.status);
  const [priority, setPriority] = useState(improvement.priority);
  const [tags, setTags] = useState(improvement.tags);
  const [assigneeId, setAssigneeId] = useState(improvement.assigneeId);
  const [dueDate, setDueDate] = useState(improvement.dueDate);
  const [tagInput, setTagInput] = useState("");
  const [assigneeSearch, setAssigneeSearch] = useState("");
  const [page, setPage] = useState(0);
  const [relinkMessageId, setRelinkMessageId] = useState<string | null>(null);

  const key = improvementKey(improvement.seq);
  const assigneeEmail = assigneeId
    ? (members.find((m) => m.userId === assigneeId)?.email ?? null)
    : null;
  const createdByEmail =
    members.find((m) => m.userId === improvement.createdBy)?.email ?? null;

  function persist(patch: Parameters<typeof updateImprovementAction>[1]) {
    startTransition(async () => {
      try {
        await updateImprovementAction(improvement.id, patch);
      } catch {
        router.refresh();
      }
    });
  }

  function saveTitle() {
    setEditingTitle(false);
    const trimmed = title.trim();
    if (trimmed && trimmed !== improvement.title) persist({ title: trimmed });
    else setTitle(improvement.title);
  }

  function saveDescription() {
    if (description !== improvement.description) persist({ description });
  }

  function changeStatus(next: ImprovementStatus) {
    setStatus(next);
    persist({ status: next });
  }
  function changePriority(next: ImprovementPriority) {
    setPriority(next);
    persist({ priority: next });
  }
  function changeAssignee(next: string | null) {
    setAssigneeId(next);
    persist({ assigneeId: next });
  }
  function changeDueDate(next: string | null) {
    setDueDate(next);
    persist({ dueDate: next });
  }
  function addTag() {
    const t = tagInput.trim();
    if (!t || tags.length >= 5 || tags.includes(t)) return;
    const next = [...tags, t];
    setTags(next);
    setTagInput("");
    persist({ tags: next });
  }
  function removeTag(t: string) {
    const next = tags.filter((x) => x !== t);
    setTags(next);
    persist({ tags: next });
  }

  function remove() {
    if (!confirm(`Delete improvement ${key}? This cannot be undone.`)) return;
    startTransition(() => deleteImprovementAction(improvement.id));
  }

  function unlink(messageId: string) {
    startTransition(async () => {
      await unlinkImprovementMessageAction(improvement.id, messageId);
      setPage(0);
      router.refresh();
    });
  }

  const filteredMembers = members.filter((m) =>
    memberDisplayName(m.email)
      .toLowerCase()
      .includes(assigneeSearch.trim().toLowerCase())
  );

  const current = associations[Math.min(page, Math.max(0, associations.length - 1))];
  const pri = priorityMeta(priority);

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      {/* Header */}
      <header className="shrink-0 px-6 pt-5 pb-4">
        <div className="mb-3 flex items-center gap-2">
          <nav className="text-muted-foreground flex items-center gap-1.5 text-sm">
            <Link href="/improvements" className="hover:text-foreground">
              All Improvements
            </Link>
            <ChevronRight className="size-3.5" />
            <span className="text-foreground">View Improvement Item</span>
          </nav>
        </div>

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="bg-muted/50 rounded-md border px-1.5 py-0.5 font-mono text-sm">
                {key}
              </span>
              {editingTitle ? (
                <Input
                  autoFocus
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  onBlur={saveTitle}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") saveTitle();
                    if (e.key === "Escape") {
                      setTitle(improvement.title);
                      setEditingTitle(false);
                    }
                  }}
                  className="h-9 w-72 text-lg font-bold"
                />
              ) : (
                <>
                  <h1 className="truncate text-xl font-bold">{title}</h1>
                  {canEdit && (
                    <button
                      type="button"
                      aria-label="Edit title"
                      onClick={() => setEditingTitle(true)}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <Pencil className="size-4" />
                    </button>
                  )}
                </>
              )}
            </div>
            <p className="text-muted-foreground mt-1 text-xs">
              Created by {memberDisplayName(createdByEmail)} on{" "}
              {formatDateTime(improvement.createdAt)}
            </p>
          </div>

          {canEdit && (
            <div className="flex items-center gap-2">
              <Button
                variant={status === "done" ? "secondary" : "default"}
                onClick={() => changeStatus("done")}
                disabled={status === "done"}
              >
                <Check className="size-4" />
                {status === "done" ? "Done" : "Mark as Done"}
              </Button>
              <Hint label="Delete improvement">
                <Button
                  variant="outline"
                  size="icon"
                  aria-label="Delete improvement"
                  onClick={remove}
                >
                  <AnimatedIcon icon={Trash2} size={16} />
                </Button>
              </Hint>
            </div>
          )}
        </div>
      </header>

      <div className="grid flex-1 gap-6 border-t px-6 py-5 lg:grid-cols-[1fr_320px]">
        {/* Main column */}
        <div className="min-w-0 space-y-6">
          <section>
            <h2 className="mb-2 font-semibold">Description</h2>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onBlur={saveDescription}
              disabled={!canEdit}
              placeholder="Describe the issue and the fix…"
              className="min-h-28"
            />
          </section>

          <SuggestedFix
            improvementId={improvement.id}
            proposal={proposal}
            canEdit={canEdit}
          />

          <section>
            <div className="bg-muted/40 mb-3 flex items-center justify-between rounded-lg px-3 py-2">
              <h2 className="font-semibold">Associated Messages</h2>
              {associations.length > 1 && (
                <div className="flex items-center gap-2 text-sm">
                  <button
                    type="button"
                    aria-label="Previous"
                    disabled={page === 0}
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                    className="disabled:opacity-40"
                  >
                    <ChevronLeft className="size-4" />
                  </button>
                  <span className="text-muted-foreground text-xs">
                    {page + 1} of {associations.length}
                  </span>
                  <button
                    type="button"
                    aria-label="Next"
                    disabled={page >= associations.length - 1}
                    onClick={() =>
                      setPage((p) => Math.min(associations.length - 1, p + 1))
                    }
                    className="disabled:opacity-40"
                  >
                    <ChevronRight className="size-4" />
                  </button>
                </div>
              )}
            </div>

            {!current && (
              <p className="text-muted-foreground rounded-xl border px-4 py-8 text-center text-sm">
                No messages are linked to this improvement.
              </p>
            )}

            {current && (
              <div className="grid gap-4 lg:grid-cols-[1fr_220px]">
                <div className="min-w-0 rounded-xl border p-4">
                  <Transcript
                    transcript={current.transcript}
                    flaggedId={current.messageId}
                  />
                  <div className="mt-3 flex flex-col gap-3 border-t pt-3 sm:flex-row sm:items-center sm:justify-between">
                    <Link
                      href={`/inbox?conversation=${current.conversationId}`}
                      className="text-primary inline-flex items-center gap-1.5 text-xs font-medium hover:underline"
                    >
                      View message in conversation context
                      <ExternalLink className="size-3" />
                    </Link>
                    {canEdit && (
                      <div className="flex flex-wrap gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => unlink(current.messageId)}
                        >
                          Unlink from this improvement
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setRelinkMessageId(current.messageId)}
                        >
                          Link to a different improvement
                        </Button>
                      </div>
                    )}
                  </div>
                </div>

                <div className="rounded-xl border p-4">
                  <h3 className="mb-2 font-semibold">Sources</h3>
                  {messageSources(current.message.content).length === 0 ? (
                    <p className="text-muted-foreground text-sm">No sources</p>
                  ) : (
                    <div className="flex flex-col gap-1">
                      {messageSources(current.message.content).map((s, i) => (
                        <span
                          key={i}
                          className="text-foreground/80 inline-flex items-center gap-1.5 truncate rounded-md border px-2.5 py-1 text-xs"
                        >
                          <span className="truncate">
                            {s.collectionName ? `${s.collectionName} — ` : ""}
                            {s.conceptTitle}
                          </span>
                          <ExternalLink className="text-muted-foreground size-3 shrink-0" />
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </section>

          {current && (
            <section className="space-y-4">
              <h2 className="font-semibold">Details</h2>
              <DetailGroup title="User">
                <DetailRow label="Name" value={current.conversation.metadata.userName} />
                <DetailRow label="Role" value={current.conversation.metadata.userRole} />
                <DetailRow label="Email" value={current.conversation.metadata.userEmail} />
                <DetailRow label="Student ID" value={null} />
              </DetailGroup>
              <DetailGroup title="Conversation">
                <DetailRow label="Assistant" value={current.conversation.assistantTitle} />
                <DetailRow
                  label="When"
                  value={formatDateTime(current.conversation.createdAt)}
                />
                <DetailRow
                  label="Messages"
                  value={String(current.conversation.messageCount)}
                />
              </DetailGroup>
              <DetailGroup title="Escalation">
                <DetailRow
                  label="Status"
                  value={
                    current.conversation.metadata.escalated
                      ? "Escalated"
                      : "Not escalated"
                  }
                />
              </DetailGroup>
              <DetailGroup title="Session">
                <DetailRow label="Launch URL" value={current.conversation.metadata.launchUrl} />
                <DetailRow label="IP address" value={current.conversation.metadata.ip} />
                <DetailRow label="Browser" value={current.conversation.metadata.browser} />
                <DetailRow label="OS" value={current.conversation.metadata.os} />
                <DetailRow label="Resolution" value={current.conversation.metadata.resolution} />
                <DetailRow label="Language" value={current.conversation.metadata.language} />
              </DetailGroup>
            </section>
          )}
        </div>

        {/* Side column: fields */}
        <aside className="h-fit space-y-1 rounded-xl border p-4">
          {/* Status */}
          <FieldPill label="Status">
            <Popover>
              <PopoverTrigger className={PILL} disabled={!canEdit}>
                {statusLabel(status)}
              </PopoverTrigger>
              <PopoverContent align="end" className="w-48 p-1">
                {IMPROVEMENT_STATUSES.map((s) => (
                  <PopoverClose
                    key={s.value}
                    render={<button type="button" />}
                    onClick={() => changeStatus(s.value)}
                    className="hover:bg-muted flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm"
                  >
                    <span
                      className={`flex size-4 items-center justify-center rounded-full border ${
                        status === s.value ? "border-primary border-4" : ""
                      }`}
                    />
                    {s.label}
                  </PopoverClose>
                ))}
              </PopoverContent>
            </Popover>
          </FieldPill>

          {/* Tags */}
          <FieldPill label="Tags">
            <Popover>
              <PopoverTrigger className={PILL} disabled={!canEdit}>
                {tags.length ? `${tags.length} tag${tags.length > 1 ? "s" : ""}` : "No tags"}
              </PopoverTrigger>
              <PopoverContent align="end" className="w-64 p-3">
                <p className="mb-0.5 text-sm font-medium">Select or add tags</p>
                <p className="text-muted-foreground mb-2 text-xs">
                  Enter to add tags (max 5 tags)
                </p>
                <div className="flex flex-wrap items-center gap-1.5 rounded-lg border p-1.5">
                  {tags.map((t) => (
                    <span
                      key={t}
                      className="bg-muted inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs"
                    >
                      {t}
                      <button
                        type="button"
                        aria-label={`Remove ${t}`}
                        onClick={() => removeTag(t)}
                      >
                        <X className="size-3" />
                      </button>
                    </span>
                  ))}
                  <input
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addTag();
                      }
                    }}
                    placeholder={tags.length >= 5 ? "Max reached" : "Search..."}
                    disabled={tags.length >= 5}
                    className="min-w-20 flex-1 bg-transparent text-sm outline-none"
                  />
                </div>
              </PopoverContent>
            </Popover>
          </FieldPill>

          {/* Priority */}
          <FieldPill label="Priority">
            <Popover>
              <PopoverTrigger className={PILL} disabled={!canEdit}>
                <pri.icon className={`size-3.5 ${pri.iconColor}`} />
                {pri.label}
              </PopoverTrigger>
              <PopoverContent align="end" className="w-40 p-1">
                {IMPROVEMENT_PRIORITIES.map((p) => (
                  <PopoverClose
                    key={p.value}
                    render={<button type="button" />}
                    onClick={() => changePriority(p.value)}
                    className="hover:bg-muted flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm"
                  >
                    <span
                      className={`flex size-4 items-center justify-center rounded-full border ${
                        priority === p.value ? "border-primary border-4" : ""
                      }`}
                    />
                    <p.icon className={`size-3.5 ${p.iconColor}`} />
                    {p.label}
                  </PopoverClose>
                ))}
              </PopoverContent>
            </Popover>
          </FieldPill>

          {/* Assigned to */}
          <FieldPill label="Assigned to">
            <Popover>
              <PopoverTrigger className={PILL} disabled={!canEdit}>
                {assigneeEmail ? (
                  <>
                    <span className="bg-primary/10 text-primary flex size-5 items-center justify-center rounded-full text-[9px] font-bold">
                      {memberInitials(assigneeEmail)}
                    </span>
                    {memberDisplayName(assigneeEmail)}
                  </>
                ) : (
                  "N/A"
                )}
              </PopoverTrigger>
              <PopoverContent align="end" className="w-64 p-2">
                <div className="relative mb-2">
                  <Search className="text-muted-foreground absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
                  <Input
                    value={assigneeSearch}
                    onChange={(e) => setAssigneeSearch(e.target.value)}
                    placeholder="Select user"
                    className="h-9 pl-8"
                  />
                </div>
                <div className="max-h-56 overflow-y-auto">
                  <PopoverClose
                    render={<button type="button" />}
                    onClick={() => changeAssignee(null)}
                    className="hover:bg-muted flex w-full items-center rounded-md px-2 py-1.5 text-left text-sm text-muted-foreground"
                  >
                    Unassigned
                  </PopoverClose>
                  {filteredMembers.map((m) => (
                    <PopoverClose
                      key={m.userId}
                      render={<button type="button" />}
                      onClick={() => changeAssignee(m.userId)}
                      className="hover:bg-muted flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm"
                    >
                      <span className="bg-primary/10 text-primary flex size-6 items-center justify-center rounded-full text-[10px] font-bold">
                        {memberInitials(m.email)}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate">
                          {memberDisplayName(m.email)}
                        </span>
                        <span className="text-muted-foreground block truncate text-xs">
                          {m.email}
                        </span>
                      </span>
                    </PopoverClose>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
          </FieldPill>

          {/* Due Date */}
          <FieldPill label="Due Date">
            <Popover>
              <PopoverTrigger className={PILL} disabled={!canEdit}>
                <CalendarIcon className="size-3.5" />
                {dueDate ? formatDay(`${dueDate}T00:00:00.000Z`) : "None"}
              </PopoverTrigger>
              <PopoverContent align="end" className="w-auto p-3">
                <Calendar value={dueDate} onSelect={(iso) => changeDueDate(iso)} />
                {dueDate && (
                  <button
                    type="button"
                    onClick={() => changeDueDate(null)}
                    className="text-muted-foreground mt-2 w-full text-center text-xs hover:underline"
                  >
                    Clear due date
                  </button>
                )}
              </PopoverContent>
            </Popover>
          </FieldPill>
        </aside>
      </div>

      <ImproveAnswerDialog
        messageId={relinkMessageId}
        onClose={() => setRelinkMessageId(null)}
        onChanged={() => {
          setRelinkMessageId(null);
          router.refresh();
        }}
      />
    </div>
  );
}

function DetailGroup({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Card size="sm" className="gap-0 p-4">
      <h3 className="mb-1 font-semibold">{title}</h3>
      {children}
    </Card>
  );
}

/** Compact conversation transcript; highlights the flagged assistant message. */
function Transcript({
  transcript,
  flaggedId,
}: {
  transcript: StoredMessage[];
  flaggedId: string;
}) {
  return (
    <div className="space-y-2.5">
      {transcript.map((m) =>
        m.role === "user" ? (
          <div key={m.id} className="flex justify-end">
            <span className="bg-primary text-primary-foreground max-w-[80%] rounded-2xl rounded-tr-sm px-3 py-1.5 text-sm">
              {messageText(m.content)}
            </span>
          </div>
        ) : (
          <div
            key={m.id}
            className={
              m.id === flaggedId
                ? "border-primary/50 bg-primary/5 rounded-xl border p-3"
                : "pl-3"
            }
          >
            <p className="text-sm leading-relaxed whitespace-pre-wrap">
              {messageText(m.content)}
            </p>
          </div>
        )
      )}
    </div>
  );
}

/**
 * The Suggested Fix panel (#390): a drafted knowledge proposal a Member reviews.
 * Accept writes a real FAQ Concept and advances the Improvement; Dismiss records
 * a reason. A missing proposal shows a "no proposal" state (drafting is
 * best-effort / off without a model credential).
 */
function SuggestedFix({
  improvementId,
  proposal,
  canEdit,
}: {
  improvementId: string;
  proposal: ImprovementProposal | null;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [dismissReason, setDismissReason] = useState("");
  const [dismissing, setDismissing] = useState(false);

  if (!proposal) {
    return (
      <section>
        <h2 className="mb-2 font-semibold">Suggested fix</h2>
        <p className="text-muted-foreground text-sm">
          No suggested fix yet. A draft is generated automatically when an answer
          is flagged.
        </p>
      </section>
    );
  }

  const { payload, status } = proposal;
  const accept = () =>
    startTransition(async () => {
      await acceptImprovementProposalAction(improvementId);
      router.refresh();
    });
  const dismiss = () =>
    startTransition(async () => {
      await dismissImprovementProposalAction(improvementId, dismissReason);
      setDismissing(false);
      router.refresh();
    });

  return (
    <section>
      <div className="mb-2 flex items-center gap-2">
        <h2 className="font-semibold">Suggested fix</h2>
        {status === "accepted" && (
          <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
            Accepted
          </span>
        )}
        {status === "dismissed" && (
          <span className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-xs font-medium">
            Dismissed
          </span>
        )}
      </div>
      <Card size="sm" className="gap-3 p-4">
        <div>
          <p className="text-muted-foreground text-xs font-medium uppercase">Question</p>
          <p className="text-sm font-medium">{payload.draftQuestion}</p>
        </div>
        <div>
          <p className="text-muted-foreground text-xs font-medium uppercase">Answer</p>
          <p className="text-sm whitespace-pre-wrap">{payload.draftAnswer}</p>
        </div>
        {payload.rationale && (
          <p className="text-muted-foreground text-sm italic">{payload.rationale}</p>
        )}
        {payload.sources.length > 0 && (
          <p className="text-muted-foreground text-xs">
            Drawn from: {payload.sources.map((s) => s.conceptTitle).join(", ")}
          </p>
        )}
        {status === "dismissed" && proposal.dismissReason && (
          <p className="text-muted-foreground text-xs">
            Dismissed: {proposal.dismissReason}
          </p>
        )}
        {status === "draft" && canEdit && (
          <div className="flex flex-col gap-2">
            {dismissing ? (
              <div className="flex flex-col gap-2">
                <Textarea
                  value={dismissReason}
                  onChange={(e) => setDismissReason(e.target.value)}
                  placeholder="Why is this fix not right? (optional)"
                  className="min-h-16"
                />
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={dismiss} disabled={pending}>
                    Confirm dismiss
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setDismissing(false)}
                    disabled={pending}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex gap-2">
                <Button size="sm" onClick={accept} disabled={pending}>
                  Accept &amp; add FAQ
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setDismissing(true)}
                  disabled={pending}
                >
                  Dismiss
                </Button>
              </div>
            )}
          </div>
        )}
      </Card>
    </section>
  );
}
