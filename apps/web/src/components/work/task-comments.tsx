"use client";

import { useId, useMemo, useRef, useState, useTransition, type KeyboardEvent } from "react";
import { Pencil, SmilePlus, Trash2 } from "lucide-react";
import { Button, Popover, PopoverClose, PopoverContent, PopoverTrigger } from "@agent-hub/ui";
import type { Project, TaskCommentReaction } from "@agent-hub/core";
import { splitMentionTokens } from "@agent-hub/core";
import type { CommentView } from "@ciele/ops";
import { Textarea } from "@/components/ui/textarea";
import { QUICK_REACTIONS } from "@/lib/message-reactions";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { agoText } from "@/lib/work/work-format";
import {
  decodeMentions,
  encodeMentions,
  insertMention,
  mentionCandidates,
  mentionQuery,
  type PickedMention,
} from "@/lib/work/mentions";
import {
  createTaskCommentAction,
  deleteTaskCommentAction,
  reactToTaskCommentAction,
  restoreTaskCommentAction,
  updateTaskCommentAction,
} from "@/app/work-actions";
import { useWorkDirectory } from "./work-directory";
import { WorkAvatar } from "./work-ui";

/**
 * A Task's comments (#1066): the thread, oldest first, and the composer under
 * it. `@` offers the Members who can read the Project and stores each pick as
 * an id token, so a mention renders as a chip under the Member's current name
 * and survives a rename. Cmd/Ctrl+Enter sends. A comment's author can edit it
 * ("Edited") or delete it, with Undo for ten minutes; anyone who can read the
 * Task can react, several emoji each.
 */

export function TaskComments({
  taskId,
  project,
  memberIds,
  comments,
  onChanged,
}: {
  taskId: string;
  project: Pick<Project, "id" | "visibility" | "createdBy">;
  memberIds: string[];
  comments: CommentView[];
  onChanged: () => void;
}) {
  const ordered = useMemo(() => [...comments].sort((a, b) => a.createdAt.localeCompare(b.createdAt)), [comments]);
  return (
    <div className="flex flex-col gap-4">
      {ordered.length > 0 && (
        <ol className="flex flex-col gap-4" aria-label="Comments">
          {ordered.map((comment) => (
            <CommentItem key={comment.id} comment={comment} project={project} memberIds={memberIds} onChanged={onChanged} />
          ))}
        </ol>
      )}
      <CommentComposer
        project={project}
        memberIds={memberIds}
        submitLabel="Comment"
        onSubmit={async (body) => {
          const result = await createTaskCommentAction(taskId, body);
          if (!result.ok) {
            toast.error(result.error);
            return false;
          }
          onChanged();
          return true;
        }}
      />
    </div>
  );
}

function CommentItem({
  comment,
  project,
  memberIds,
  onChanged,
}: {
  comment: CommentView;
  project: Pick<Project, "id" | "visibility" | "createdBy">;
  memberIds: string[];
  onChanged: () => void;
}) {
  const dir = useWorkDirectory();
  const [editing, setEditing] = useState(false);
  const [, startTransition] = useTransition();
  const author = dir.person(comment.authorMemberId);
  const mine = Boolean(comment.authorMemberId) && comment.authorMemberId === dir.viewerId;

  const remove = () =>
    startTransition(async () => {
      const result = await deleteTaskCommentAction(comment.id);
      if (!result.ok) return toast.error(result.error);
      onChanged();
      toast.undo("Comment deleted", async () => {
        const restored = await restoreTaskCommentAction(comment.id);
        onChanged();
        return restored;
      });
    });

  return (
    <li className="group/comment flex gap-2.5">
      <WorkAvatar person={author} size="md" className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-sm">
          <span className="font-medium">{author?.name ?? (comment.authorTeammateId ? "A Teammate" : "Someone")}</span>
          <time dateTime={comment.createdAt} className="text-muted-foreground text-xs">
            {agoText(comment.createdAt)}
          </time>
          {comment.editedAt && <span className="text-muted-foreground text-xs">Edited</span>}
          {mine && !editing && (
            <span className="ml-auto flex items-center opacity-0 transition-opacity group-hover/comment:opacity-100 [@media(hover:none)]:opacity-100 focus-within:opacity-100">
              <Button size="icon-sm" variant="ghost" aria-label="Edit comment" onClick={() => setEditing(true)}>
                <Pencil className="size-3.5" />
              </Button>
              <Button size="icon-sm" variant="ghost" aria-label="Delete comment" onClick={remove}>
                <Trash2 className="size-3.5" />
              </Button>
            </span>
          )}
        </div>
        {editing ? (
          <CommentComposer
            project={project}
            memberIds={memberIds}
            initial={comment.body}
            submitLabel="Save"
            onCancel={() => setEditing(false)}
            onSubmit={async (body) => {
              const result = await updateTaskCommentAction(comment.id, body);
              if (!result.ok) {
                toast.error(result.error);
                return false;
              }
              setEditing(false);
              onChanged();
              return true;
            }}
          />
        ) : (
          <CommentBody body={comment.body} />
        )}
        {/* Keyed by the server's list, so a reload replaces the optimistic one. */}
        <Reactions key={comment.reactions.map((r) => r.id).join()} commentId={comment.id} reactions={comment.reactions} />
      </div>
    </li>
  );
}

/** A stored body: text as written, each mention a chip under the Member's current name. */
export function CommentBody({ body }: { body: string }) {
  const dir = useWorkDirectory();
  return (
    <p className="mt-0.5 text-sm leading-relaxed break-words whitespace-pre-wrap">
      {splitMentionTokens(body).map((segment, i) =>
        segment.kind === "text" ? (
          <span key={i}>{segment.text}</span>
        ) : (
          <span key={i} className="bg-tone-blue text-tone-blue-ink rounded px-1 font-medium" data-member={segment.memberId}>
            @{dir.person(segment.memberId)?.name ?? segment.name}
          </span>
        )
      )}
    </p>
  );
}

function Reactions({ commentId, reactions: initial }: { commentId: string; reactions: TaskCommentReaction[] }) {
  const dir = useWorkDirectory();
  const [reactions, setReactions] = useState(initial);
  const [, startTransition] = useTransition();
  const groups = useMemo(() => {
    const map = new Map<string, TaskCommentReaction[]>();
    for (const reaction of reactions) map.set(reaction.emoji, [...(map.get(reaction.emoji) ?? []), reaction]);
    return [...map];
  }, [reactions]);
  const mine = (emoji: string) => reactions.some((r) => r.emoji === emoji && r.userId === dir.viewerId);

  const toggle = (emoji: string) => {
    const on = !mine(emoji);
    const before = reactions;
    // Optimistic: the pill moves at once, and settles from the server's list.
    setReactions(
      on
        ? [...reactions, { id: `local-${emoji}`, organizationId: "", projectId: "", commentId, userId: dir.viewerId, emoji, createdAt: new Date().toISOString() }]
        : reactions.filter((r) => !(r.emoji === emoji && r.userId === dir.viewerId))
    );
    startTransition(async () => {
      const result = await reactToTaskCommentAction(commentId, emoji, on);
      if (!result.ok) {
        setReactions(before);
        return toast.error(result.error);
      }
      setReactions(result.value);
    });
  };

  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1">
      {groups.map(([emoji, list]) => (
        <button
          key={emoji}
          type="button"
          aria-pressed={mine(emoji)}
          title={list.map((r) => dir.person(r.userId)?.name ?? "Someone").join(", ")}
          onClick={() => toggle(emoji)}
          className={cn(
            "press-control inline-flex h-6 items-center gap-1 rounded-full border px-2 text-xs tabular-nums",
            mine(emoji) ? "border-tone-blue-ink/40 bg-tone-blue text-tone-blue-ink" : "border-alpha-medium hover:bg-alpha-light"
          )}
        >
          <span aria-hidden>{emoji}</span>
          {list.length}
        </button>
      ))}
      <Popover>
        <PopoverTrigger
          render={
            <button
              type="button"
              aria-label="Add reaction"
              className={cn(
                "press-control text-muted-foreground hover:bg-alpha-light hover:text-foreground data-[popup-open]:opacity-100 grid size-6 place-items-center rounded-full",
                !groups.length && "opacity-0 group-hover/comment:opacity-100 [@media(hover:none)]:opacity-100 focus-visible:opacity-100"
              )}
            />
          }
        >
          <SmilePlus className="size-3.5" />
        </PopoverTrigger>
        <PopoverContent align="start" className="flex w-auto gap-0.5 p-1">
          {QUICK_REACTIONS.map((emoji) => (
            <PopoverClose
              key={emoji}
              render={<button type="button" />}
              aria-label={`React ${emoji}`}
              aria-pressed={mine(emoji)}
              onClick={() => toggle(emoji)}
              className={cn("hover:bg-alpha-light grid size-8 place-items-center rounded-md text-base", mine(emoji) && "bg-alpha-light")}
            >
              {emoji}
            </PopoverClose>
          ))}
        </PopoverContent>
      </Popover>
    </div>
  );
}

/** The composer: plain text with `@` mentions, sent with the button or Cmd/Ctrl+Enter. */
export function CommentComposer({
  project,
  memberIds,
  initial = "",
  submitLabel,
  onSubmit,
  onCancel,
}: {
  project: Pick<Project, "visibility" | "createdBy">;
  memberIds: string[];
  initial?: string;
  submitLabel: string;
  /** Resolves true when the comment went through, so the draft can clear. */
  onSubmit: (body: string) => Promise<boolean>;
  onCancel?: () => void;
}) {
  const dir = useWorkDirectory();
  const decoded = useMemo(() => decodeMentions(initial, (id) => dir.person(id)?.name ?? null), [initial, dir]);
  const [text, setText] = useState(decoded.text);
  const [picked, setPicked] = useState<PickedMention[]>(decoded.picked);
  const [query, setQuery] = useState<{ start: number; query: string } | null>(null);
  const [active, setActive] = useState(0);
  const [pending, startTransition] = useTransition();
  const field = useRef<HTMLTextAreaElement>(null);

  const candidates = useMemo(
    () => (query ? mentionCandidates(dir.people, project, memberIds, query.query, dir.viewerId) : []),
    [query, dir, project, memberIds]
  );

  const track = (value: string, caret: number) => {
    setText(value);
    setQuery(mentionQuery(value, caret));
    setActive(0);
  };

  const pick = (person: { userId: string; name: string }) => {
    const el = field.current;
    if (!el || !query) return;
    const next = insertMention(text, query.start, el.selectionStart, person.name);
    setText(next.text);
    setPicked((current) => [...current.filter((p) => p.id !== person.userId), { id: person.userId, name: person.name }]);
    setQuery(null);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(next.caret, next.caret);
    });
  };

  const send = () => {
    const body = encodeMentions(text.trim(), picked);
    if (!body || pending) return;
    startTransition(async () => {
      if (!(await onSubmit(body))) return;
      setText("");
      setPicked([]);
    });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (query && candidates.length) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        setActive((i) => (i + (event.key === "ArrowDown" ? 1 : -1) + candidates.length) % candidates.length);
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        pick(candidates[active]!);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setQuery(null);
        return;
      }
    }
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      send();
    }
    if (event.key === "Escape" && onCancel) {
      event.stopPropagation();
      onCancel();
    }
  };

  const listId = useId();
  return (
    <div className="relative mt-1">
      <div className="focus-within:border-ring focus-within:ring-ring/50 rounded-xl border transition-[border-color,box-shadow] focus-within:ring-3">
        <Textarea
          ref={field}
          value={text}
          rows={2}
          maxLength={10000}
          placeholder="Leave a comment. @ to mention someone."
          aria-label={initial ? "Edit comment" : "Comment"}
          role="combobox"
          aria-expanded={Boolean(query && candidates.length)}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={query && candidates.length ? `${listId}-${active}` : undefined}
          autoFocus={Boolean(initial)}
          onChange={(event) => track(event.target.value, event.target.selectionStart)}
          onKeyDown={onKeyDown}
          onBlur={() => setTimeout(() => setQuery(null), 120)}
          className="min-h-16 resize-none border-0 shadow-none focus-visible:ring-0"
        />
        <div className="flex items-center justify-end gap-2 px-2 pb-2">
          <span className="text-muted-foreground mr-auto pl-1 text-xs">
            <kbd className="font-sans">⌘</kbd>/<kbd className="font-sans">Ctrl</kbd> + Enter to send
          </span>
          {onCancel && (
            <Button size="sm" variant="ghost" className="h-7" onClick={onCancel}>
              Cancel
            </Button>
          )}
          <Button size="sm" className="h-7" disabled={!text.trim()} loading={pending} onClick={send}>
            {submitLabel}
          </Button>
        </div>
      </div>
      {query && candidates.length > 0 && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Mention someone"
          className="bg-popover text-popover-foreground shadow-strong border-alpha-medium absolute top-full left-2 z-20 mt-1 w-64 overflow-hidden rounded-lg border p-1"
        >
          {candidates.map((person, i) => (
            <li
              key={person.userId}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(event) => {
                event.preventDefault();
                pick(person);
              }}
              onMouseEnter={() => setActive(i)}
              className="aria-selected:bg-alpha-light flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm"
            >
              <WorkAvatar person={person} size="sm" />
              <span className="min-w-0 flex-1 truncate">{person.name}</span>
              <span className="text-muted-foreground truncate text-xs">{person.email}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
