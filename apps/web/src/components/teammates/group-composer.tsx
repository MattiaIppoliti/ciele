"use client";

import { useId, useRef, useState } from "react";
import type { KeyboardEvent, SyntheticEvent } from "react";
import { Paperclip } from "lucide-react";
import type { ChatModelOption } from "@agent-hub/agent/client";
import { AUTO_CHAT_MODEL, toPromptModels } from "@/components/chat/use-chat-models";
import { useAttachments } from "@/components/chat/use-attachments";
import { AttachmentInput, AttachmentChips, AttachmentDropHint } from "@/components/chat/attachment-chips";
import { readChatAttachmentAction } from "@/app/actions";
import { PromptInput } from "@/components/agents/prompt-input";
import { ComposerPulse } from "@/components/chat/composer-pulse";
import { GeneratedAvatar } from "@/components/ui/generated-avatar";
import {
  TriggerList,
  TriggerRow,
  triggerInputProps,
} from "@/components/chat/trigger-list";
import {
  activeMention,
  insertMention,
  mentionMatches,
  splitMentions,
  type ActiveMention,
  type MentionTarget,
} from "@/lib/teammates/mention";

/**
 * The group's composer: the widget/preview chat's input (same PromptInput,
 * same focus/loading border pulse), plus the one thing only a group needs, the
 * `@` picker. Typing `@` opens the roster above the input, with the same
 * generated faces the header strip wears; picking a row inserts the exact name
 * `parseChannelMentions` will later resolve.
 *
 * The list logic (which token, who matches, what gets inserted) lives in
 * `lib/teammates/mention.ts`, tested there; this file is only the wiring:
 * caret tracking, keyboard steering, and keeping focus in the textarea.
 */
export function GroupComposer({
  targets,
  models,
  teammateId,
  onSubmit,
  pending,
  placeholder,
  "aria-label": ariaLabel,
}: {
  targets: MentionTarget[];
  models: ChatModelOption[];
  teammateId?: string;
  /** Resolves false when the message did not go out; its text comes back. */
  onSubmit: (value: string, model: string, attachments: string[]) => Promise<boolean> | void;
  /** While a chain is streaming: the composer wears the loading pulse. */
  pending: boolean;
  placeholder: string;
  "aria-label": string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [model, setModel] = useState(AUTO_CHAT_MODEL);
  const attachments = useAttachments(async (file) => {
    const body = new FormData();
    body.set("file", file);
    if (teammateId) body.set("teammateId", teammateId);
    return readChatAttachmentAction(body);
  });
  const [draft, setDraft] = useState("");
  const [mention, setMention] = useState<ActiveMention | null>(null);
  const [highlighted, setHighlighted] = useState(0);
  // Escape closes the picker for this token only; typing on re-opens it.
  const dismissed = useRef<number | null>(null);

  const textarea = () =>
    containerRef.current?.querySelector("textarea") ?? null;

  const matches = mention ? mentionMatches(targets, mention.query) : [];
  const open = mention !== null && matches.length > 0;

  /** Re-reads the token under the caret; called on every edit or caret move. */
  function sync(value: string) {
    const el = textarea();
    const caret = el ? el.selectionStart : value.length;
    const next = activeMention(value, caret);
    // A dismissal is keyed to one `@`'s index, so it is only meaningful while
    // that character is still an `@` at that index. Editing earlier in the line
    // shifts every index after it, and clearing the box drops them all; without
    // this check a stale index goes on muting whatever `@` lands there next.
    if (dismissed.current !== null && value[dismissed.current] !== "@") {
      dismissed.current = null;
    }
    if (next && dismissed.current === next.start) {
      setMention(null);
      return;
    }
    if (next?.start !== mention?.start) {
      setHighlighted(0);
      dismissed.current = null;
    }
    setMention(next);
  }

  function pick(target: MentionTarget) {
    if (!mention) return;
    const el = textarea();
    const caret = el ? el.selectionStart : draft.length;
    const next = insertMention(draft, mention, caret, target.name);
    setDraft(next.text);
    setMention(null);
    // The inserted `@Name ` is still a valid token under the caret, and the
    // caret move re-runs `sync`; marking its `@` dismissed keeps the picker
    // from reopening on the name it just wrote.
    dismissed.current = mention.start;
    // The caret belongs right after the inserted name; set it once React has
    // written the new value into the textarea.
    requestAnimationFrame(() => {
      const node = textarea();
      if (!node) return;
      node.focus({ preventScroll: true });
      node.setSelectionRange(next.caret, next.caret);
    });
  }

  /**
   * Runs before PromptInput's own Enter handling, which honors
   * `defaultPrevented`: while the picker is open, Enter and Tab pick, the
   * arrows steer, and Escape dismisses, none of which sends the message.
   */
  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (!open) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const delta = event.key === "ArrowDown" ? 1 : -1;
      setHighlighted(
        (current) => (current + delta + matches.length) % matches.length
      );
      return;
    }
    if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      pick(matches[Math.min(highlighted, matches.length - 1)]);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      dismissed.current = mention?.start ?? null;
      setMention(null);
    }
  }

  return (
    <div ref={containerRef} className="relative" {...attachments.dropProps}>
      <AttachmentInput inputRef={fileInputRef} accept={attachments.accept} onPick={(file) => void attachments.attach(file)} />
      <AttachmentChips entries={attachments.entries} onRemove={attachments.remove} />
      {attachments.dragging && <AttachmentDropHint label="Drop to attach" />}
      {open && (
        <TriggerList
          id={listId}
          label="Mention someone"
          items={matches}
          highlighted={highlighted}
          onHighlight={setHighlighted}
          onPick={pick}
          renderItem={(target) => (
            <>
              <GeneratedAvatar seed={target.avatarSeed} size="size-7" />
              <TriggerRow
                name={target.name}
                hint={
                  target.kind === "teammate"
                    ? target.title || "Teammate"
                    : "Person"
                }
              />
            </>
          )}
        />
      )}
      <ComposerPulse loading={pending}>
        <PromptInput
          // A resolved name is tinted where it stands, and wears the face of
          // whoever it names.
          //
          // Nothing here may change a glyph's advance: this layer has to wrap
          // exactly like the textarea under it, or the caret drifts off the
          // character it is editing. So the chip gets no padding, and the face is
          // drawn *over* the `@` rather than in front of it, on an absolute box
          // that takes no space. The `@` itself goes `invisible` rather than being
          // dropped, because `visibility: hidden` keeps its width and a removed
          // character would not. The posted message has no caret to keep honest,
          // so there the chip is a real padded pill (see `MentionText`).
          highlight={splitMentions(draft, targets).map((segment, index) =>
            segment.kind === "mention" ? (
              <span
                key={index}
                className="bg-primary/20 text-primary relative rounded-[4px] font-medium"
              >
                <span className="invisible">@</span>
                <GeneratedAvatar
                  seed={segment.target.avatarSeed}
                  size="size-3.5"
                  // 14px over an `@` that is about 8px wide, pulled left so the
                  // overhang lands on the space before the name rather than on
                  // its first letter.
                  className="absolute top-1/2 left-0 -translate-x-[4px] -translate-y-1/2"
                />
                {segment.text.slice(1)}
              </span>
            ) : (
              <span key={index}>{segment.text}</span>
            )
          )}
          value={draft}
          onValueChange={(value) => {
            setDraft(value);
            sync(value);
          }}
          onSubmit={(value) => {
            if (attachments.busy) return;
            setDraft("");
            setMention(null);
            // The sent message took its `@` with it, so the dismissal keyed to
            // that `@`'s index has to go too. Without this, picking a name and
            // sending left `dismissed` pointing at index 0, and the next message
            // starting with `@` was silently treated as the one already
            // dismissed: the picker never opened again for the rest of the
            // session.
            dismissed.current = null;
            void Promise.resolve(onSubmit(value, model, attachments.tokens)).then((sent) => {
              // Unless something new was typed meanwhile, the words come back.
              if (sent === false) setDraft((current) => current || value);
            });
          }}
          // While a chain streams the composer refuses to submit, so Enter
          // keeps the draft rather than clearing it for a send that bails.
          models={toPromptModels(models, true)}
          model={model}
          onModelChange={setModel}
          actions={[{ value: "attach", label: "Attach file", icon: <Paperclip />, disabled: attachments.full }]}
          onAction={() => fileInputRef.current?.click()}
          onPaste={attachments.onPaste}
          loading={pending}
          {...triggerInputProps(listId, open, Math.min(highlighted, matches.length - 1))}
          minRows={1}
          maxRows={6}
          placeholder={placeholder}
          aria-label={ariaLabel}
          // Caret moves without an edit (click, arrows) re-read the token too.
          onSelect={(event: SyntheticEvent<HTMLTextAreaElement>) =>
            sync(event.currentTarget.value)
          }
          onKeyDown={handleKeyDown}
          onBlur={() => setMention(null)}
        />
      </ComposerPulse>
    </div>
  );
}
