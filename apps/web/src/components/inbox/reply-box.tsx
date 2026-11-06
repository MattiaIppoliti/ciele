"use client";

import { useEffect, useRef, useState } from "react";
import { filterQuickTexts, insertQuickText, slashQueryAt, type QuickText } from "@agent-hub/core";
import { Button } from "@agent-hub/ui";
import { quickTextsForConversationAction } from "@/app/(admin)/inbox/operator-actions";

type PickerItem = Pick<QuickText, "id" | "title" | "folder"> & { text: string };

/**
 * The Inbox reply box (#1082) with Quick Texts (#1085): typing `/` opens the
 * Organization's saved replies filtered by title; choosing one puts its body,
 * already filled from this Conversation, where the `/` was. The Member can
 * still edit it before sending.
 */
export function ReplyBox({
  conversationId,
  busy,
  onSend,
}: {
  conversationId: string;
  busy: boolean;
  /** Resolves true when the reply went out, so the box clears. */
  onSend: (text: string) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState("");
  const [cursor, setCursor] = useState(0);
  const [quickTexts, setQuickTexts] = useState<PickerItem[] | null>(null);
  const [highlighted, setHighlighted] = useState(0);
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let cancelled = false;
    void quickTextsForConversationAction(conversationId)
      .then((result) => {
        if (!cancelled) setQuickTexts(result.ok ? result.value : []);
      })
      .catch(() => {
        if (!cancelled) setQuickTexts([]);
      });
    return () => {
      cancelled = true;
    };
  }, [conversationId]);

  const slash = slashQueryAt(draft, cursor);
  const matches = slash && slash.start !== dismissedAt ? filterQuickTexts(quickTexts ?? [], slash.query) : [];
  const open = matches.length > 0;
  const active = Math.min(highlighted, Math.max(0, matches.length - 1));

  function choose(item: PickerItem) {
    if (!slash) return;
    const next = insertQuickText(draft, slash, cursor, item.text);
    setDraft(next.text);
    setCursor(next.cursor);
    setHighlighted(0);
    requestAnimationFrame(() => {
      textarea.current?.focus();
      textarea.current?.setSelectionRange(next.cursor, next.cursor);
    });
  }

  async function send() {
    const text = draft.trim();
    if (!text || busy) return;
    if (await onSend(text)) {
      setDraft("");
      setCursor(0);
    }
  }

  return (
    <form
      className="relative flex items-end gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        void send();
      }}
    >
      {open && (
        <ul
          role="listbox"
          aria-label="Quick Texts"
          className="bg-popover absolute bottom-full left-0 z-20 mb-2 max-h-64 w-full max-w-md overflow-y-auto rounded-xl border p-1 shadow-strong"
        >
          {matches.map((item, index) => (
            <li key={item.id} role="option" aria-selected={index === active}>
              <button
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(item)}
                onMouseEnter={() => setHighlighted(index)}
                className={`press w-full rounded-lg px-3 py-2 text-left text-sm ${index === active ? "bg-muted" : ""}`}
              >
                <span className="block font-medium">
                  {item.title}
                  {item.folder && <span className="text-muted-foreground font-normal"> · {item.folder}</span>}
                </span>
                <span className="text-muted-foreground line-clamp-1 block text-xs">{item.text}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <textarea
        ref={textarea}
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value);
          setCursor(event.target.selectionStart);
          setDismissedAt(null);
        }}
        onSelect={(event) => setCursor(event.currentTarget.selectionStart)}
        onKeyDown={(event) => {
          if (open) {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              const step = event.key === "ArrowDown" ? 1 : -1;
              setHighlighted((active + step + matches.length) % matches.length);
              return;
            }
            if (event.key === "Enter" || event.key === "Tab") {
              event.preventDefault();
              choose(matches[active]!);
              return;
            }
            if (event.key === "Escape") {
              event.preventDefault();
              setDismissedAt(slash?.start ?? null);
              return;
            }
          }
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            void send();
          }
        }}
        rows={2}
        maxLength={4000}
        aria-label="Reply to the Visitor"
        placeholder="Reply to the Visitor… Type / for a Quick Text"
        className="border-input bg-background focus-visible:ring-ring min-h-16 flex-1 resize-y rounded-xl border px-3 py-2 text-sm outline-none focus-visible:ring-2"
      />
      <Button variant="primary" size="sm" type="submit" disabled={busy || !draft.trim()}>
        Send
      </Button>
    </form>
  );
}
