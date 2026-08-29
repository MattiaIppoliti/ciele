"use client";

import { useRef, useState } from "react";
import type { KeyboardEvent, SyntheticEvent } from "react";
import { PromptInput } from "@/components/agents/prompt-input";
import { ComposerPulse } from "@/components/chat/composer-pulse";
import { GeneratedAvatar } from "@/components/ui/generated-avatar";
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
  onSubmit,
  pending,
  placeholder,
  "aria-label": ariaLabel,
}: {
  targets: MentionTarget[];
  onSubmit: (value: string) => void;
  /** While a chain is streaming: the composer wears the loading pulse. */
  pending: boolean;
  placeholder: string;
  "aria-label": string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState("");
  const [mention, setMention] = useState<ActiveMention | null>(null);
  const [highlighted, setHighlighted] = useState(0);
  // Escape closes the picker for this token only; typing on re-opens it.
  const dismissed = useRef<number | null>(null);
  const [focusPulse, setFocusPulse] = useState(false);

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

  function fireFocusPulse() {
    if (focusPulse) return;
    setFocusPulse(true);
    window.setTimeout(() => setFocusPulse(false), 1100);
  }

  return (
    <div ref={containerRef} className="relative">
      {open && (
        <div
          role="listbox"
          aria-label="Mention someone"
          className="bg-popover text-popover-foreground absolute inset-x-0 bottom-full z-20 mb-2 overflow-hidden rounded-xl border shadow-lg"
        >
          <ul className="max-h-64 overflow-y-auto p-1.5">
            {matches.map((target, index) => (
              <li key={target.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={index === highlighted}
                  // Mousedown would steal the textarea's focus (and with it the
                  // caret the insertion needs), so the press is swallowed and
                  // the click does the picking.
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => pick(target)}
                  onMouseEnter={() => setHighlighted(index)}
                  // `cursor-pointer` explicitly: Tailwind v4's preflight gives
                  // every `button` `cursor: default`, so a picker row that
                  // steers with the arrow keys looked unclickable to a pointer.
                  //
                  // `bg-foreground/10` rather than `bg-muted`: this list sits on
                  // `bg-popover`, and in dark mode the two are close enough that
                  // the highlight was invisible, which left no way to see where
                  // the keyboard was in the list.
                  className={`flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors ${
                    index === highlighted
                      ? "bg-foreground/10"
                      : "hover:bg-foreground/5"
                  }`}
                >
                  <GeneratedAvatar seed={target.avatarSeed} size="size-7" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      {target.name}
                    </span>
                    <span className="text-muted-foreground block truncate text-xs">
                      {target.kind === "teammate"
                        ? target.title || "Teammate"
                        : "Person"}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {(focusPulse || pending) && (
        <ComposerPulse
          color="var(--primary)"
          focus={focusPulse}
          loading={pending}
        />
      )}
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
          setDraft("");
          setMention(null);
          // The sent message took its `@` with it, so the dismissal keyed to
          // that `@`'s index has to go too. Without this, picking a name and
          // sending left `dismissed` pointing at index 0, and the next message
          // starting with `@` was silently treated as the one already
          // dismissed: the picker never opened again for the rest of the
          // session.
          dismissed.current = null;
          onSubmit(value);
        }}
        minRows={1}
        maxRows={6}
        placeholder={placeholder}
        aria-label={ariaLabel}
        onFocus={fireFocusPulse}
        // Caret moves without an edit (click, arrows) re-read the token too.
        onSelect={(event: SyntheticEvent<HTMLTextAreaElement>) =>
          sync(event.currentTarget.value)
        }
        onKeyDown={handleKeyDown}
        onBlur={() => setMention(null)}
      />
    </div>
  );
}
