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
                  className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors ${
                    index === highlighted ? "bg-muted" : ""
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
        value={draft}
        onValueChange={(value) => {
          setDraft(value);
          sync(value);
        }}
        onSubmit={(value) => {
          setDraft("");
          setMention(null);
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
