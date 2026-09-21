"use client";

import type { ReactNode } from "react";

/**
 * The list a composer trigger opens, above the input.
 *
 * Presentational only; `useComposerTrigger` owns which token is open, who
 * matches and where the keyboard is. Shared so the three triggers look like one
 * control rather than three that grew separately.
 */
export function TriggerList<T extends { id: string }>({
  label,
  items,
  highlighted,
  onHighlight,
  onPick,
  renderItem,
}: {
  label: string;
  items: readonly T[];
  highlighted: number;
  onHighlight: (index: number) => void;
  onPick: (item: T) => void;
  renderItem: (item: T) => ReactNode;
}) {
  return (
    <div
      role="listbox"
      aria-label={label}
      className="bg-popover text-popover-foreground absolute inset-x-0 bottom-full z-20 mb-2 overflow-hidden rounded-xl border shadow-lg"
    >
      <ul className="max-h-64 overflow-y-auto p-1.5">
        {items.map((item, index) => (
          <li key={item.id}>
            <button
              type="button"
              role="option"
              aria-selected={index === highlighted}
              // Mousedown would steal the textarea's focus (and with it the
              // caret the insertion needs), so the press is swallowed and the
              // click does the picking.
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onPick(item)}
              onMouseEnter={() => onHighlight(index)}
              // `cursor-pointer` explicitly: Tailwind v4's preflight gives
              // every `button` `cursor: default`, so a row that steers with the
              // arrow keys looked unclickable to a pointer.
              //
              // `bg-foreground/10` rather than `bg-muted`: this list sits on
              // `bg-popover`, and in dark mode the two are close enough that
              // the highlight was invisible, which left no way to see where the
              // keyboard was in the list.
              className={`flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors ${
                index === highlighted
                  ? "bg-foreground/10"
                  : "hover:bg-foreground/5"
              }`}
            >
              {renderItem(item)}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The two-line row every trigger list uses: a name, and what it will do. */
export function TriggerRow({
  name,
  hint,
  icon,
}: {
  name: string;
  hint?: string;
  icon?: ReactNode;
}) {
  return (
    <>
      {icon ? (
        <span className="text-muted-foreground grid size-7 shrink-0 place-items-center [&_svg]:size-4">
          {icon}
        </span>
      ) : null}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{name}</span>
        {hint ? (
          <span className="text-muted-foreground block truncate text-xs">
            {hint}
          </span>
        ) : null}
      </span>
    </>
  );
}
