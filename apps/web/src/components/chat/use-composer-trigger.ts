"use client";

import { useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import {
  activeToken,
  matchByName,
  replaceToken,
  type ActiveToken,
} from "@/lib/composer/token";

/** Anything a trigger can offer. The `name` is what the query matches. */
export interface TriggerItem {
  id: string;
  name: string;
}

/**
 * One trigger character on a composer: the token under the caret, the list it
 * opens, and the keyboard steering that goes with it.
 *
 * The three triggers in the product do different things when something is
 * picked, so picking is the caller's: `@` in a channel inserts a name, `@` in
 * the widget opens the support panel, `/` replaces the draft with a Skill's
 * opening line. What they share is this, and it is more than it looks: the
 * escape-dismissal keyed to one token's index, the re-read on every caret move,
 * and running before `PromptInput`'s own Enter handling so that picking a row
 * never also sends the message.
 */
export function useComposerTrigger<T extends TriggerItem>({
  trigger,
  items,
  textarea,
  priority,
  onPick,
}: {
  trigger: string;
  items: readonly T[];
  /**
   * The composer's textarea, for the caret. A getter rather than a ref because
   * `PromptInput` owns the element and exposes no ref; every caller finds it
   * the same way, by querying its own container.
   */
  textarea: () => HTMLTextAreaElement | null;
  /** Ranks kinds that are not peers; see `matchByName`. */
  priority?: (item: T) => number;
  /**
   * What picking does. It receives the token so a caller that edits the text
   * can call `replaceToken` itself, and one that opens a panel can simply drop
   * the token with `clear`.
   */
  onPick: (item: T, token: ActiveToken) => void;
}) {
  const [token, setToken] = useState<ActiveToken | null>(null);
  const [highlighted, setHighlighted] = useState(0);
  // Escape closes the list for this token only; typing on reopens it.
  const dismissed = useRef<number | null>(null);

  const matches = token ? matchByName(items, token.query, priority) : [];
  const open = token !== null && matches.length > 0;

  /** Re-reads the token under the caret; call on every edit or caret move. */
  function sync(value: string) {
    const element = textarea();
    const caret = element ? element.selectionStart : value.length;
    const next = activeToken(value, caret, trigger);
    // A dismissal is keyed to one trigger's index, so it is only meaningful
    // while that character is still the trigger at that index. Editing earlier
    // in the line shifts every index after it, and clearing the box drops them
    // all; without this check a stale index goes on muting whatever trigger
    // lands there next.
    if (dismissed.current !== null && value[dismissed.current] !== trigger) {
      dismissed.current = null;
    }
    if (next && dismissed.current === next.start) {
      setToken(null);
      return;
    }
    if (next?.start !== token?.start) {
      setHighlighted(0);
      dismissed.current = null;
    }
    setToken(next);
  }

  /** Picking wrote the name back: stop this token reopening on what it wrote. */
  function settle(caret: number) {
    const start = token?.start ?? null;
    setToken(null);
    dismissed.current = start;
    requestAnimationFrame(() => {
      const node = textarea();
      if (!node) return;
      node.focus({ preventScroll: true });
      node.setSelectionRange(caret, caret);
    });
  }

  /** The token is gone with the text it was in; forget the dismissal too. */
  function reset() {
    setToken(null);
    dismissed.current = null;
  }

  function pick(item: T) {
    if (!token) return;
    onPick(item, token);
  }

  /**
   * Opens the list from a button instead of a keystroke, by writing the trigger
   * the button stands for.
   *
   * The `+` menu is a way to *find* the triggers, not a second way to do what
   * they do: one list, reachable two ways, rather than two lists that can
   * disagree about what is on them.
   */
  function openFromButton(value: string, setValue: (next: string) => void) {
    const spacer = value && !/\s$/.test(value) ? " " : "";
    const next = `${value}${spacer}${trigger}`;
    setValue(next);
    dismissed.current = null;
    setHighlighted(0);
    setToken({ start: next.length - trigger.length, query: "" });
    requestAnimationFrame(() => {
      const node = textarea();
      if (!node) return;
      node.focus({ preventScroll: true });
      node.setSelectionRange(next.length, next.length);
    });
  }

  /**
   * Runs before `PromptInput`'s own Enter handling, which honours
   * `defaultPrevented`: while the list is open, Enter and Tab pick, the arrows
   * steer, and Escape dismisses, none of which sends the message.
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
      dismissed.current = token?.start ?? null;
      setToken(null);
    }
  }

  return {
    open,
    matches,
    highlighted,
    setHighlighted,
    sync,
    pick,
    openFromButton,
    settle,
    reset,
    handleKeyDown,
    /** Closes the list without dismissing the token (blur). */
    close: () => setToken(null),
  };
}

export { replaceToken };
export type { ActiveToken };
