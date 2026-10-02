"use client";
import { StatusBadge as StatusPill, type StatusBadgeStatus } from "@/components/spaceui/status-badge";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import type {
  Improvement,
  ImprovementAssociationPage,
  ImprovementPriority,
  ImprovementProposal,
  ImprovementStatus,
  StoredMessage,
} from "@agent-hub/core";
import { messageText } from "@agent-hub/core";
import type { ChatReplyPart } from "@agent-hub/agent/client";

import { ExternalLink, Plus, Search, Trash2, X } from "lucide-react";
import { Calendar as CalendarIcon, Check, ChevronLeft, ChevronRight, Loader2, SquareArrowOutUpRight } from "lucide-react";
import { AnimatedIcon } from "@/components/ui/animated-icon";
import { AnimatedGlyph } from "@/components/ui/animated-icon";
import { FoldersIcon } from "@/components/ui/icons/folders";
import { ProjectDialog } from "@/components/projects/project-dialog";
import {
  acceptImprovementProposalAction,
  deleteImprovementAction,
  dismissImprovementProposalAction,
  getImprovementAssociationPageAction,
  unlinkImprovementMessageAction,
  updateImprovementAction,
} from "@/app/actions";
import { ImproveAnswerDialog } from "@/components/inbox/improve-answer-dialog";
import { Button } from "@agent-hub/ui";
import { Calendar } from "@/components/ui/calendar";
import {
  isRedirectError,
  useConfirmDelete,
} from "@/components/ui/confirm-delete-modal";
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
import { EmptyState } from "@/components/ui/empty-state";
import { formatDateTime, formatDay } from "@/lib/format";
import {
  IMPROVEMENT_PRIORITIES,
  IMPROVEMENT_STATUSES,
  improvementKey,
  improvementKeyClass,
  priorityMeta,
  statusLabel,
} from "@/lib/improvements";
import { memberDisplayName } from "@/lib/members";
import { UserAvatar } from "@/components/ui/user-avatar";
import { toast } from "@/lib/toast";
import { unsavedEdits } from "./improvement-edits";
import { RollInText } from "@/components/motion/roll-in-text";
import { RollingNumber } from "@/components/motion/rolling-number";

interface MemberOption {
  userId: string;
  email: string;
}

/** The citations an answer carries, from its stored `sources` reply part. */
function messageSources(content: unknown[]) {
  const part = (content as ChatReplyPart[]).find((p) => p.type === "sources");
  return part?.type === "sources" ? (part.sources ?? []) : [];
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
function FieldPill({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <span className="text-muted-foreground text-sm">{label}</span>
      {children}
    </div>
  );
}

/**
 * Title and description edit in place, the way they read: no border, no box,
 * no edit button. The hover and focus tint is the only affordance, and it is
 * what says "these words are the field" without drawing a form around them.
 */
const INLINE_FIELD =
  // `dark:bg-transparent` is load-bearing, not tidying: the Textarea primitive
  // fills itself with `dark:bg-input/30`, and `bg-transparent` alone does not
  // override a dark-variant rule. Without it these fields were exactly the box
  // this constant exists to avoid, on the theme most of the console runs in.
  "resize-none rounded-md border-0 bg-transparent dark:bg-transparent px-2 -mx-2 shadow-none transition-colors hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:ring-0 disabled:cursor-default disabled:bg-transparent disabled:opacity-100";

const PILL =
  "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors hover:bg-muted disabled:opacity-60";

const STATUS: Record<ImprovementStatus, StatusBadgeStatus> = {
  to_do: "offline",
  in_progress: "info",
  in_review: "away",
  done: "online",
  archived: "offline",
};

export function ImprovementDetail({
  improvement,
  associationPage,
  members,
  proposal,
  projects,
  canEdit,
  variant = "page",
  onUpdated,
  onDeleted,
}: {
  improvement: Improvement;
  associationPage: ImprovementAssociationPage;
  members: MemberOption[];
  proposal: ImprovementProposal | null;
  /**
   * Live Projects this work can belong to (#771). Archived ones are not
   * offered: attaching to one would file the work under something the team has
   * stopped running.
   */
  projects: { id: string; name: string }[];
  canEdit: boolean;
  /**
   * "drawer" drops the breadcrumb (the drawer has its own header), the columns
   * need no flag, they respond to the container's width, not the viewport's.
   */
  variant?: "page" | "drawer";
  onUpdated?: (improvement: Improvement) => void;
  /**
   * The row is gone server-side. The board drops every copy it holds on this,
   * instead of waiting for a refreshed page to prove the absence.
   */
  onDeleted?: (improvementId: string) => void;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const { confirmDelete, confirmDeleteModal } = useConfirmDelete();

  const [title, setTitle] = useState(improvement.title);
  const [description, setDescription] = useState(improvement.description);
  const [status, setStatus] = useState(improvement.status);
  const [priority, setPriority] = useState(improvement.priority);
  const [tags, setTags] = useState(improvement.tags);
  const [assigneeId, setAssigneeId] = useState(improvement.assigneeId);
  const [dueDate, setDueDate] = useState(improvement.dueDate);
  const [projectId, setProjectId] = useState(improvement.projectId);
  /**
   * Projects created from this popover, on top of the prop: the prop only
   * refreshes with the page, and a project made here has to be attachable and
   * nameable the moment it exists.
   */
  const [createdProjects, setCreatedProjects] = useState<
    { id: string; name: string }[]
  >([]);
  /** The Project view, open on a new Project (`null`) or on the attached one. */
  const [projectDialog, setProjectDialog] = useState<{
    projectId: string | null;
  } | null>(null);
  const [tagInput, setTagInput] = useState("");
  const [assigneeSearch, setAssigneeSearch] = useState("");
  const [page, setPage] = useState(0);
  const [associations, setAssociations] = useState(
    associationPage.associations,
  );
  const [associationTotal, setAssociationTotal] = useState(
    associationPage.total,
  );
  const [loadingAssociation, setLoadingAssociation] = useState(false);
  const [relinkMessageId, setRelinkMessageId] = useState<string | null>(null);

  const key = improvementKey(improvement.seq);
  const assigneeEmail = assigneeId
    ? (members.find((m) => m.userId === assigneeId)?.email ?? null)
    : null;
  const createdByEmail =
    members.find((m) => m.userId === improvement.createdBy)?.email ?? null;
  const projectOptions = [
    ...projects,
    ...createdProjects.filter(
      (created) => !projects.some((project) => project.id === created.id)
    ),
  ];
  const projectName =
    projectOptions.find((project) => project.id === projectId)?.name ?? null;

  /**
   * What the server last accepted for the two free-text fields. The prop is
   * the value at mount, so comparing against it after one save would resend
   * an unchanged title and skip a revert back to the original. Moved ahead of
   * the round trip (and rolled back on failure) so a blur followed by the
   * unmount flush cannot send the same edit twice.
   */
  const saved = useRef({
    title: improvement.title,
    description: improvement.description,
  });
  /** Set by Escape so the blur it triggers discards instead of saving. */
  const cancelTitle = useRef(false);
  const latest = useRef({ title, description });
  useEffect(() => {
    latest.current = { title, description };
  }, [title, description]);

  function persist(
    patch: Parameters<typeof updateImprovementAction>[1],
    revert: () => void,
  ) {
    startTransition(async () => {
      try {
        const updated = await updateImprovementAction(improvement.id, patch);
        onUpdated?.(updated);
      } catch {
        // The field already shows the new value, so put back what the server
        // still has and say so, rather than leave a change that never landed.
        revert();
        toast.error(`Could not update ${key}. Please try again.`);
        router.refresh();
      }
    });
  }

  function saveTitle() {
    const previous = saved.current.title;
    if (cancelTitle.current) {
      cancelTitle.current = false;
      setTitle(previous);
      return;
    }
    const trimmed = title.trim();
    if (!trimmed || trimmed === previous) {
      setTitle(previous);
      return;
    }
    saved.current.title = trimmed;
    persist({ title: trimmed }, () => {
      saved.current.title = previous;
      setTitle(previous);
    });
  }

  function saveDescription() {
    const previous = saved.current.description;
    if (description === previous) return;
    saved.current.description = description;
    persist({ description }, () => {
      saved.current.description = previous;
      setDescription(previous);
    });
  }

  // Closing the drawer with Escape, or navigating away, unmounts the fields
  // without a blur, which used to drop whatever was typed since the last one.
  // The flush reads refs, so it sends the newest text, and it bypasses the
  // transition because nothing is left on screen to roll back.
  const onUpdatedRef = useRef(onUpdated);
  useEffect(() => {
    onUpdatedRef.current = onUpdated;
  }, [onUpdated]);
  useEffect(() => {
    const id = improvement.id;
    const refs = { saved, latest, onUpdatedRef };
    return () => {
      const patch = unsavedEdits(refs.saved.current, refs.latest.current);
      if (!patch) return;
      Object.assign(refs.saved.current, patch);
      updateImprovementAction(id, patch)
        .then((updated) => refs.onUpdatedRef.current?.(updated))
        .catch(() => toast.error("Could not save your last edit."));
    };
  }, [improvement.id]);

  // The full page can be left by closing the tab, which no unmount sees.
  useEffect(() => {
    if (variant !== "page") return;
    const warn = (event: BeforeUnloadEvent) => {
      if (unsavedEdits(saved.current, latest.current)) event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [variant]);

  function changeStatus(next: ImprovementStatus) {
    const previous = status;
    setStatus(next);
    persist({ status: next }, () => setStatus(previous));
  }
  function changePriority(next: ImprovementPriority) {
    const previous = priority;
    setPriority(next);
    persist({ priority: next }, () => setPriority(previous));
  }
  function changeAssignee(next: string | null) {
    const previous = assigneeId;
    setAssigneeId(next);
    persist({ assigneeId: next }, () => setAssigneeId(previous));
  }
  function changeDueDate(next: string | null) {
    const previous = dueDate;
    setDueDate(next);
    persist({ dueDate: next }, () => setDueDate(previous));
  }
  function changeProject(next: string | null) {
    const previous = projectId;
    setProjectId(next);
    persist({ projectId: next }, () => setProjectId(previous));
  }
  function addTag() {
    const t = tagInput.trim();
    if (!t || tags.length >= 5 || tags.includes(t)) return;
    const previous = tags;
    const next = [...tags, t];
    setTags(next);
    setTagInput("");
    persist({ tags: next }, () => setTags(previous));
  }
  function removeTag(t: string) {
    const previous = tags;
    const next = tags.filter((x) => x !== t);
    setTags(next);
    persist({ tags: next }, () => setTags(previous));
  }

  function remove() {
    confirmDelete({
      title: <>Delete {key}?</>,
      description:
        "This permanently removes the improvement and cannot be undone.",
      confirmLabel: "Delete improvement",
      onConfirm: () =>
        deleteImprovementAction(improvement.id).catch((error: unknown) => {
          // The action always redirects after deleting, and a redirect
          // surfaces as a throw the router must still see: the row is gone
          // all the same, so tell the board before rethrowing.
          if (isRedirectError(error)) onDeleted?.(improvement.id);
          throw error;
        }),
    });
  }

  function unlink(messageId: string) {
    startTransition(async () => {
      try {
        await unlinkImprovementMessageAction(improvement.id, messageId);
        setAssociations((current) =>
          current.filter((association) => association.messageId !== messageId),
        );
        setAssociationTotal((total) => Math.max(0, total - 1));
        setPage((current) => Math.max(0, current - 1));
      } catch {
        toast.error("Could not unlink the message.");
      }
    });
  }

  async function nextAssociation() {
    const next = page + 1;
    if (next < associations.length) {
      setPage(next);
      return;
    }
    if (associations.length >= associationTotal || loadingAssociation) return;
    const loadedIndex = associations.length;
    setLoadingAssociation(true);
    try {
      const result = await getImprovementAssociationPageAction(
        improvement.id,
        associations.length,
      );
      setAssociationTotal(result.total);
      if (result.associations[0]) {
        setAssociations((current) => [...current, result.associations[0]!]);
        setPage(loadedIndex);
      }
    } catch {
      toast.error("Could not load the next associated message.");
    } finally {
      setLoadingAssociation(false);
    }
  }

  const filteredMembers = members.filter((m) =>
    memberDisplayName(m.email)
      .toLowerCase()
      .includes(assigneeSearch.trim().toLowerCase()),
  );

  const current =
    associations[Math.min(page, Math.max(0, associations.length - 1))];
  const sources = current ? messageSources(current.message.content) : [];
  const pri = priorityMeta(priority);

  return (
    <div className="@container flex h-full flex-col overflow-y-auto">
      {/* Header */}
      <header className="shrink-0 px-6 pt-5 pb-4">
        {variant === "page" && (
          <div className="mb-3 flex items-center gap-2">
            <nav
              aria-label="Breadcrumb"
              className="text-muted-foreground flex items-center gap-1.5 text-sm"
            >
              <Link
                href="/improvements"
                className="hover:text-foreground press-text"
              >
                All Improvements
              </Link>
              <ChevronRight className="size-3.5" aria-hidden />
              <span className="text-foreground" aria-current="page">
                View Improvement Item
              </span>
            </nav>
          </div>
        )}

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <span
              className={`inline-block rounded-md border px-1.5 py-0.5 font-mono text-sm ${improvementKeyClass(status)}`}
            >
              {key}
            </span>
            {/* The title is the field, not a label with a pencil beside it:
                click the words and type. Auto-grows, so a long title wraps
                instead of scrolling out of its own box. */}
            {canEdit ? (
              <>
              {/* The textarea is not a heading, so the page would have none;
                  this one names it for a screen reader's heading list. */}
              <h1 className="sr-only">{title || "Untitled improvement"}</h1>
              <Textarea
                value={title}
                rows={1}
                aria-label="Improvement title"
                placeholder="Improvement title"
                onChange={(e) => setTitle(e.target.value.slice(0, 300))}
                onBlur={saveTitle}
                onKeyDown={(e) => {
                  // Enter commits rather than opening a second line: this is a
                  // title, and blurring is what every other field here saves on.
                  if (e.key === "Enter") {
                    e.preventDefault();
                    e.currentTarget.blur();
                  }
                  if (e.key === "Escape") {
                    // The blur below would otherwise save what was typed.
                    cancelTitle.current = true;
                    e.currentTarget.blur();
                  }
                }}
                /* Plain words, the way a Project's title is (project-dialog):
                   no border, and no hover/focus tint either. INLINE_FIELD's
                   tint is a full-width block behind a heading, which reads as
                   a box drawn around the title rather than as an affordance. */
                className="mt-1 min-h-0 resize-none border-0 bg-transparent p-0 text-2xl font-semibold tracking-tight shadow-none focus-visible:ring-0 focus-visible:underline focus-visible:decoration-ring focus-visible:decoration-2 focus-visible:underline-offset-8 disabled:cursor-default disabled:bg-transparent disabled:opacity-100 md:text-2xl dark:bg-transparent"
              />
              </>
            ) : (
              <h1 className="mt-1 text-2xl font-semibold tracking-tight">{title}</h1>
            )}
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
                <RollInText text={status === "done" ? "Done" : "Mark as Done"} />
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

      {/* @5xl, not @4xl: at 896px the fixed 320px panel left the main column
          ~500px, which is narrower than the transcript it has to hold. Below
          this the panel keeps everything it has and stacks under the content
          instead of squeezing it. */}
      <div className="@5xl:grid-cols-[1fr_320px] grid flex-1 gap-6 border-t px-6 py-5">
        {/* Main column */}
        <div className="min-w-0 space-y-6">
          {/* Straight under the title and in the same hand: a description is
              the issue in prose, not a form field about it. */}
          <Textarea
            value={description}
            rows={3}
            onChange={(e) => setDescription(e.target.value)}
            onBlur={saveDescription}
            disabled={!canEdit}
            aria-label="Description"
            placeholder="Add a description, or what the fix should be…"
            className={INLINE_FIELD + " min-h-20 text-base md:text-sm"}
          />

          <SuggestedFix
            improvementId={improvement.id}
            proposal={proposal}
            canEdit={canEdit}
          />

          <section>
            <div className="bg-muted/40 mb-3 flex items-center justify-between rounded-lg px-3 py-2">
              <h2 className="font-semibold">Associated Messages</h2>
              {associationTotal > 1 && (
                <div className="flex items-center gap-2 text-sm">
                  <button
                    type="button"
                    aria-label="Previous message"
                    disabled={page === 0}
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                    className="hover:bg-muted press-control rounded-md p-0.5 transition-colors disabled:opacity-40"
                  >
                    <ChevronLeft className="size-4" />
                  </button>
                  <span
                    aria-live="polite"
                    className="text-muted-foreground text-xs tabular-nums"
                  >
                    <RollingNumber value={page + 1} /> of{" "}
                    <RollingNumber value={associationTotal} />
                  </span>
                  <button
                    type="button"
                    aria-label="Next message"
                    aria-busy={loadingAssociation || undefined}
                    disabled={page >= associationTotal - 1 || loadingAssociation}
                    onClick={() => void nextAssociation()}
                    className="hover:bg-muted press-control rounded-md p-0.5 transition-colors disabled:opacity-40"
                  >
                    {loadingAssociation ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <ChevronRight className="size-4" />
                    )}
                  </button>
                </div>
              )}
            </div>

            {!current && !loadingAssociation && (
              <EmptyState size="sm" className="rounded-xl border" title="No linked messages"
                description="Link a flagged answer from the Inbox to keep the conversation with this improvement." />
            )}

            {current && (
              <div className="@2xl:grid-cols-[1fr_220px] grid gap-4">
                {/* Its own container: the row below used viewport breakpoints
                    while living in a container-query column, so a wide window
                    turned it horizontal inside a 240px box and its buttons
                    overflowed the card. */}
                <div className="@container bg-card min-w-0 rounded-xl border p-4">
                  <Transcript
                    transcript={current.transcript}
                    flaggedId={current.messageId}
                  />
                  <div className="@xl:flex-row @xl:items-center @xl:justify-between mt-3 flex flex-col gap-3 border-t pt-3">
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
                          onClick={() =>
                            confirmDelete({
                              title: "Unlink this message?",
                              description:
                                "The answer stops counting as evidence for this improvement. Linking it again means finding it in the Inbox.",
                              confirmLabel: "Unlink",
                              onConfirm: () => unlink(current.messageId),
                            })
                          }
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

                <div className="bg-card rounded-xl border p-4">
                  <h3 className="mb-2 font-semibold">Sources</h3>
                  {sources.length === 0 ? (
                    <EmptyState size="sm" title="No sources" description="This answer has no stored source citations." />
                  ) : (
                    <div className="flex flex-col gap-1">
                      {sources.map((s, i) => (
                        // A citation carries no URL, so the chip is a label,
                        // not a link, and draws no "opens elsewhere" icon.
                        <span
                          key={i}
                          className="text-foreground/80 truncate rounded-md border px-2.5 py-1 text-xs"
                        >
                          {s.collectionName ? `${s.collectionName}, ` : ""}
                          {s.conceptTitle}
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
                <DetailRow
                  label="Name"
                  value={current.conversation.metadata.userName}
                />
                <DetailRow
                  label="Role"
                  value={current.conversation.metadata.userRole}
                />
                <DetailRow
                  label="Email"
                  value={current.conversation.metadata.userEmail}
                />
              </DetailGroup>
              <DetailGroup title="Conversation">
                <DetailRow
                  label="Assistant"
                  value={current.conversation.assistantTitle}
                />
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
                <DetailRow
                  label="Launch URL"
                  value={current.conversation.metadata.launchUrl}
                />
                <DetailRow
                  label="IP address"
                  value={current.conversation.metadata.ip}
                />
                <DetailRow
                  label="Browser"
                  value={current.conversation.metadata.browser}
                />
                <DetailRow
                  label="OS"
                  value={current.conversation.metadata.os}
                />
                <DetailRow
                  label="Resolution"
                  value={current.conversation.metadata.resolution}
                />
                <DetailRow
                  label="Language"
                  value={current.conversation.metadata.language}
                />
              </DetailGroup>
            </section>
          )}
        </div>

        {/* Side column: fields */}
        <aside className="bg-card h-fit space-y-1 rounded-xl border p-4">
          {/* Status */}
          <FieldPill label="Status">
            <Popover>
              <PopoverTrigger
                className={PILL}
                disabled={!canEdit}
                aria-label={`Status: ${statusLabel(status)}`}
              >
                <StatusPill
                  status={STATUS[status]}
                  className="bg-transparent px-0 py-0"
                  primaryText={<RollInText text={statusLabel(status)} />}
                />
              </PopoverTrigger>
              <PopoverContent align="end" className="w-48 p-1">
                {IMPROVEMENT_STATUSES.map((s) => (
                  <PopoverClose
                    key={s.value}
                    render={<button type="button" />}
                    onClick={() => changeStatus(s.value)}
                    aria-pressed={status === s.value}
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
              <PopoverTrigger
                className={PILL}
                disabled={!canEdit}
                aria-label={`Tags: ${tags.length ? tags.join(", ") : "none"}`}
              >
                <RollInText
                  text={
                    tags.length
                      ? `${tags.length} tag${tags.length > 1 ? "s" : ""}`
                      : "No tags"
                  }
                />
              </PopoverTrigger>
              <PopoverContent align="end" className="w-64 p-3">
                <p className="mb-0.5 text-sm font-medium">Select or add tags</p>
                <p className="text-muted-foreground mb-2 text-xs">
                  Enter to add tags (max 5 tags)
                </p>
                <div className="focus-within:border-ring focus-within:ring-ring/50 flex flex-wrap items-center gap-1.5 rounded-lg border p-1.5 transition-[border-color,box-shadow] focus-within:ring-3">
                  {tags.map((t) => (
                    <span
                      key={t}
                      className="bg-muted inline-flex max-w-full min-w-0 items-center gap-1 rounded-md px-2 py-0.5 text-xs"
                    >
                      <span className="truncate">{t}</span>
                      <button
                        type="button"
                        className="shrink-0"
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
                    placeholder={tags.length >= 5 ? "Max reached" : "Search…"}
                    aria-label="Add a tag"
                    autoComplete="off"
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
              <PopoverTrigger
                className={PILL}
                disabled={!canEdit}
                aria-label={`Priority: ${pri.label}`}
              >
                <pri.icon className={`size-3.5 ${pri.iconColor}`} />
                <RollInText text={pri.label} />
              </PopoverTrigger>
              <PopoverContent align="end" className="w-40 p-1">
                {IMPROVEMENT_PRIORITIES.map((p) => (
                  <PopoverClose
                    key={p.value}
                    render={<button type="button" />}
                    onClick={() => changePriority(p.value)}
                    aria-pressed={priority === p.value}
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
              <PopoverTrigger
                className={PILL}
                disabled={!canEdit}
                aria-label={`Assignee: ${
                  assigneeEmail ? memberDisplayName(assigneeEmail) : "unassigned"
                }`}
              >
                {assigneeEmail ? (
                  <>
                    <UserAvatar
                      userId={assigneeId}
                      email={assigneeEmail}
                      size="size-5"
                    />
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
                    aria-label="Search members"
                    autoComplete="off"
                    className="h-9 pl-8"
                  />
                </div>
                <div className="max-h-56 overflow-y-auto">
                  <PopoverClose
                    render={<button type="button" />}
                    onClick={() => changeAssignee(null)}
                    aria-pressed={assigneeId === null}
                    className="hover:bg-muted flex w-full items-center rounded-md px-2 py-1.5 text-left text-sm text-muted-foreground"
                  >
                    Unassigned
                  </PopoverClose>
                  {filteredMembers.map((m) => (
                    <PopoverClose
                      key={m.userId}
                      render={<button type="button" />}
                      onClick={() => changeAssignee(m.userId)}
                      aria-pressed={assigneeId === m.userId}
                      className="hover:bg-muted flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm"
                    >
                      <UserAvatar
                        userId={m.userId}
                        email={m.email}
                        size="size-6"
                      />
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

          {/* Project (#771): which piece of work this belongs to. */}
          <FieldPill label="Project">
            <Popover>
              <PopoverTrigger
                className={PILL}
                disabled={!canEdit}
                aria-label={`Project: ${projectName ?? "none"}`}
              >
                <AnimatedGlyph icon={FoldersIcon} size={14} />
                {projectName ?? "Add to project"}
              </PopoverTrigger>
              <PopoverContent align="end" className="w-64 p-1">
                <div className="max-h-56 overflow-y-auto">
                  <PopoverClose
                    render={<button type="button" />}
                    onClick={() => changeProject(null)}
                    aria-pressed={projectId === null}
                    className="hover:bg-muted text-muted-foreground flex w-full items-center rounded-md px-2 py-1.5 text-left text-sm"
                  >
                    No project
                  </PopoverClose>
                  {projectOptions.map((project) => (
                    <PopoverClose
                      key={project.id}
                      render={<button type="button" />}
                      onClick={() => changeProject(project.id)}
                      aria-pressed={projectId === project.id}
                      className="hover:bg-muted flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm"
                    >
                      <span
                        className={`flex size-4 shrink-0 items-center justify-center rounded-full border ${
                          projectId === project.id ? "border-primary border-4" : ""
                        }`}
                      />
                      <span className="truncate">{project.name}</span>
                    </PopoverClose>
                  ))}
                </div>
                {/* Kept out of the list and behind a rule, so "file this under
                    something new" never sits one stray click away from "file
                    this under Atlas". It opens the Project view rather than a
                    name field, because a project worth creating here is worth
                    saying what it is about. */}
                <div className="mt-1 border-t pt-1">
                  {projectId && (
                    <PopoverClose
                      render={<button type="button" />}
                      onClick={() => setProjectDialog({ projectId })}
                      className="hover:bg-muted flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm"
                    >
                      <SquareArrowOutUpRight className="size-3.5" />
                      Open {projectName}
                    </PopoverClose>
                  )}
                  <PopoverClose
                    render={<button type="button" />}
                    onClick={() => setProjectDialog({ projectId: null })}
                    className="hover:bg-muted flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm"
                  >
                    <Plus className="size-3.5" />
                    Create new project…
                  </PopoverClose>
                </div>
              </PopoverContent>
            </Popover>
          </FieldPill>

          {/* Due Date */}
          <FieldPill label="Due Date">
            <Popover>
              <PopoverTrigger
                className={PILL}
                disabled={!canEdit}
                aria-label={`Due date: ${
                  dueDate ? formatDay(`${dueDate}T00:00:00.000Z`) : "none"
                }`}
              >
                <CalendarIcon className="size-3.5" />
                {dueDate ? formatDay(`${dueDate}T00:00:00.000Z`) : "None"}
              </PopoverTrigger>
              <PopoverContent align="end" className="w-auto p-3">
                <Calendar
                  value={dueDate}
                  onSelect={(iso) => changeDueDate(iso)}
                />
                {dueDate && (
                  <button
                    type="button"
                    onClick={() => changeDueDate(null)}
                    className="text-muted-foreground press-text mt-2 w-full text-center text-xs hover:underline"
                  >
                    Clear due date
                  </button>
                )}
              </PopoverContent>
            </Popover>
          </FieldPill>
        </aside>
      </div>

      {projectDialog && (
        <ProjectDialog
          open
          projectId={projectDialog.projectId}
          onClose={() => setProjectDialog(null)}
          onCreated={(project) => {
            setCreatedProjects((prev) => [...prev, project]);
            changeProject(project.id);
          }}
          onDeleted={(deletedId) => {
            // The row is already detached server-side (`on delete set null`);
            // this is the same fact on screen.
            if (projectId === deletedId) setProjectId(null);
          }}
        />
      )}

      <ImproveAnswerDialog
        messageId={relinkMessageId}
        onClose={() => setRelinkMessageId(null)}
        onChanged={() => {
          setRelinkMessageId(null);
        }}
      />

      {confirmDeleteModal}
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

/**
 * A long conversation paints only the messages near the viewport; the
 * intrinsic size is a guess at one short turn, and `auto` swaps in the real
 * height once a message has rendered, so the scrollbar settles.
 */
const OFFSCREEN_MESSAGE =
  "[content-visibility:auto] [contain-intrinsic-size:auto_3rem]";

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
          <div key={m.id} className={`flex justify-end ${OFFSCREEN_MESSAGE}`}>
            <span className="bg-primary text-primary-foreground max-w-[80%] rounded-2xl rounded-tr-sm px-3 py-1.5 text-sm [overflow-wrap:anywhere]">
              {messageText(m.content)}
            </span>
          </div>
        ) : (
          <div
            key={m.id}
            className={`${OFFSCREEN_MESSAGE} ${
              m.id === flaggedId
                ? "border-primary/50 bg-primary/5 rounded-xl border p-3"
                : "pl-3"
            }`}
          >
            <p className="text-sm leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]">
              {messageText(m.content)}
            </p>
          </div>
        ),
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
  const [pending, startTransition] = useTransition();
  const [dismissReason, setDismissReason] = useState("");
  const [dismissing, setDismissing] = useState(false);
  // The prop only refreshes with the page, so the outcome is kept here too:
  // without it Accept and Dismiss stayed on screen after they had worked.
  const [decided, setDecided] = useState<{
    status: "accepted" | "dismissed";
    reason: string | null;
  } | null>(null);

  if (!proposal) {
    return (
      <section>
        <h2 className="mb-2 font-semibold">Suggested fix</h2>
        <p className="text-muted-foreground text-sm">
          No suggested fix yet. A draft is generated automatically when an
          answer is flagged.
        </p>
      </section>
    );
  }

  const { payload } = proposal;
  const status = decided?.status ?? proposal.status;
  const dismissedReason = decided ? decided.reason : proposal.dismissReason;
  const accept = () =>
    startTransition(async () => {
      try {
        await acceptImprovementProposalAction(improvementId);
        setDecided({ status: "accepted", reason: null });
        // Accepted into Knowledge: an outcome, and the toast carries its cue (#817).
        toast.success("Fix accepted and added as an FAQ.");
      } catch {
        toast.error("Could not accept the fix. Please try again.");
      }
    });
  const dismiss = () =>
    startTransition(async () => {
      try {
        await dismissImprovementProposalAction(improvementId, dismissReason);
        setDecided({
          status: "dismissed",
          reason: dismissReason.trim() || null,
        });
        setDismissing(false);
        toast.success("Fix dismissed.");
      } catch {
        toast.error("Could not dismiss the fix. Please try again.");
      }
    });

  return (
    <section>
      <div className="mb-2 flex items-center gap-2">
        <h2 className="font-semibold">Suggested fix</h2>
        {status === "accepted" && (
          <StatusPill status="online" primaryText={<RollInText text="Accepted" />} />
        )}
        {status === "dismissed" && (
          <StatusPill status="offline" primaryText={<RollInText text="Dismissed" />} />
        )}
      </div>
      <Card size="sm" className="gap-3 p-4">
        <div>
          <p className="text-muted-foreground text-xs font-medium uppercase">
            Question
          </p>
          <p className="text-sm font-medium">{payload.draftQuestion}</p>
        </div>
        <div>
          <p className="text-muted-foreground text-xs font-medium uppercase">
            Answer
          </p>
          <p className="text-sm whitespace-pre-wrap">{payload.draftAnswer}</p>
        </div>
        {payload.rationale && (
          <p className="text-muted-foreground text-sm italic">
            {payload.rationale}
          </p>
        )}
        {payload.sources.length > 0 && (
          <p className="text-muted-foreground text-xs">
            Drawn from: {payload.sources.map((s) => s.conceptTitle).join(", ")}
          </p>
        )}
        {status === "dismissed" && dismissedReason && (
          <p className="text-muted-foreground text-xs">
            Dismissed: {dismissedReason}
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
                  aria-label="Reason for dismissing the fix"
                  className="min-h-16"
                />
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={dismiss}
                    disabled={pending}
                  >
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
