"use client";

import { forwardRef, useImperativeHandle, useRef, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import {
  Bold,
  Code,
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  Italic,
  Link2,
  List,
  ListOrdered,
  Minus,
  Redo2,
  RemoveFormatting,
  TextQuote,
  Undo2,
  Unlink,
  type LucideIcon,
} from "lucide-react";
import { Button, Hint } from "@agent-hub/ui";
import { Textarea } from "@/components/ui/textarea";
import { applyMarkdownCommand, type MarkdownCommand } from "@/lib/markdown-toolbar";
import { cn } from "@/lib/utils";

/**
 * A textarea under a markdown toolbar (#1066). The General section's welcome
 * message, the FAQ answer and a Task's description all write markdown with the
 * same buttons; this is the one place those buttons live. The value stays
 * plain markdown: every button is an `applyMarkdownCommand` over the
 * selection, and a wrap keeps the original selection selected inside its new
 * markers. The optional history is character-granular undo and redo over
 * what the editor itself changed.
 */

export interface MarkdownButton {
  label: string;
  Icon: LucideIcon;
  command: MarkdownCommand;
}

const stripLinks = (s: string) => s.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");

/** Headings, lists, a divider and a link: enough for a welcome message. */
export const MARKDOWN_TOOLBAR_BASIC: MarkdownButton[][] = [
  [
    { label: "Bold", Icon: Bold, command: { wrap: "**" } },
    { label: "Italic", Icon: Italic, command: { wrap: "*" } },
  ],
  [
    { label: "Heading 1", Icon: Heading1, command: { prefix: "# " } },
    { label: "Heading 2", Icon: Heading2, command: { prefix: "## " } },
    { label: "Heading 3", Icon: Heading3, command: { prefix: "### " } },
    { label: "Heading 4", Icon: Heading4, command: { prefix: "#### " } },
  ],
  [
    { label: "Bullet list", Icon: List, command: { prefix: "- " } },
    { label: "Numbered list", Icon: ListOrdered, command: { prefix: "1. " } },
    { label: "Divider", Icon: Minus, command: { prefix: "\n---\n" } },
    { label: "Link", Icon: Link2, command: { wrap: "[", wrapEnd: "](url)" } },
  ],
];

/** Everything: clear formatting, code, quotes and unlinking too. */
export const MARKDOWN_TOOLBAR_FULL: MarkdownButton[][] = [
  [
    { label: "Bold", Icon: Bold, command: { wrap: "**" } },
    { label: "Italic", Icon: Italic, command: { wrap: "*" } },
    {
      label: "Clear formatting",
      Icon: RemoveFormatting,
      command: { transform: (s) => stripLinks(s).replace(/\*\*|\*|`|^#+\s/gm, "") },
    },
    { label: "Code", Icon: Code, command: { wrap: "`" } },
  ],
  MARKDOWN_TOOLBAR_BASIC[1]!,
  [
    { label: "Blockquote", Icon: TextQuote, command: { prefix: "> " } },
    { label: "Divider", Icon: Minus, command: { prefix: "\n---\n" } },
    { label: "Bullet list", Icon: List, command: { prefix: "- " } },
    { label: "Numbered list", Icon: ListOrdered, command: { prefix: "1. " } },
  ],
  [
    { label: "Link", Icon: Link2, command: { wrap: "[", wrapEnd: "](url)" } },
    { label: "Remove link", Icon: Unlink, command: { transform: stripLinks } },
  ],
];

/** A compact set for a Task's description. */
export const MARKDOWN_TOOLBAR_COMPACT: MarkdownButton[][] = [
  [
    { label: "Bold", Icon: Bold, command: { wrap: "**" } },
    { label: "Italic", Icon: Italic, command: { wrap: "*" } },
    { label: "Code", Icon: Code, command: { wrap: "`" } },
  ],
  [
    { label: "Heading", Icon: Heading3, command: { prefix: "### " } },
    { label: "Bullet list", Icon: List, command: { prefix: "- " } },
    { label: "Numbered list", Icon: ListOrdered, command: { prefix: "1. " } },
    { label: "Blockquote", Icon: TextQuote, command: { prefix: "> " } },
  ],
  [{ label: "Link", Icon: Link2, command: { wrap: "[", wrapEnd: "](url)" } }],
];

export const MarkdownEditor = forwardRef<
  HTMLTextAreaElement,
  {
    value: string;
    onChange: (value: string) => void;
    toolbar?: MarkdownButton[][];
    /** Undo and redo buttons over the editor's own edits. */
    history?: boolean;
    id?: string;
    name?: string;
    rows?: number;
    maxLength?: number;
    placeholder?: string;
    autoFocus?: boolean;
    "aria-label"?: string;
    "aria-invalid"?: boolean;
    "aria-describedby"?: string;
    onKeyDown?: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
    onBlur?: () => void;
    className?: string;
    /** Beside the toolbar, at its right end. */
    actions?: ReactNode;
  }
>(function MarkdownEditor(
  { value, onChange, toolbar = MARKDOWN_TOOLBAR_BASIC, history = false, maxLength, className, actions, onBlur, ...field },
  ref
) {
  const textarea = useRef<HTMLTextAreaElement>(null);
  useImperativeHandle(ref, () => textarea.current!, []);
  const undoStack = useRef<string[]>([]);
  const redoStack = useRef<string[]>([]);
  const container = useRef<HTMLDivElement>(null);

  const set = (next: string) => {
    const bounded = maxLength ? next.slice(0, maxLength) : next;
    if (history) {
      undoStack.current.push(value);
      if (undoStack.current.length > 500) undoStack.current.shift();
      redoStack.current = [];
    }
    onChange(bounded);
  };

  const apply = (command: MarkdownCommand) => {
    const el = textarea.current;
    if (!el) return;
    const { selectionStart, selectionEnd } = el;
    set(applyMarkdownCommand(el.value, selectionStart, selectionEnd, command));
    requestAnimationFrame(() => {
      el.focus();
      if ("wrap" in command) el.setSelectionRange(selectionStart + command.wrap.length, selectionEnd + command.wrap.length);
    });
  };

  const step = (from: RefObject<string[]>, to: RefObject<string[]>) => {
    const target = from.current.pop();
    if (target === undefined) return;
    to.current.push(value);
    onChange(target);
  };

  return (
    <div
      ref={container}
      // Leaving the editor means leaving the whole box, not the textarea for
      // a toolbar button: a blur that lands on a button is still editing.
      onBlur={(event) => {
        if (onBlur && !container.current?.contains(event.relatedTarget as Node | null)) onBlur();
      }}
      className={cn(
        "focus-within:border-ring focus-within:ring-ring/50 rounded-xl border transition-[border-color,box-shadow] focus-within:ring-3",
        className
      )}
    >
      <div role="toolbar" aria-label="Formatting" className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-2 py-1.5">
        {toolbar.map((group, g) => (
          <span key={g} className="flex items-center gap-0.5">
            {group.map((button) => (
              <Hint key={button.label} label={button.label}>
                <Button type="button" variant="ghost" size="icon-sm" aria-label={button.label} onClick={() => apply(button.command)}>
                  <button.Icon className="size-4" />
                </Button>
              </Hint>
            ))}
          </span>
        ))}
        {history && (
          <span className="flex items-center gap-0.5">
            <Hint label="Undo">
              <Button type="button" variant="ghost" size="icon-sm" aria-label="Undo" onClick={() => step(undoStack, redoStack)}>
                <Undo2 className="size-4" />
              </Button>
            </Hint>
            <Hint label="Redo">
              <Button type="button" variant="ghost" size="icon-sm" aria-label="Redo" onClick={() => step(redoStack, undoStack)}>
                <Redo2 className="size-4" />
              </Button>
            </Hint>
          </span>
        )}
        {actions && <span className="ml-auto flex items-center gap-1">{actions}</span>}
      </div>
      <Textarea
        ref={textarea}
        value={value}
        maxLength={maxLength}
        onChange={(event) => set(event.target.value)}
        className="resize-none rounded-t-none border-0 shadow-none focus-visible:ring-0"
        {...field}
      />
    </div>
  );
});
