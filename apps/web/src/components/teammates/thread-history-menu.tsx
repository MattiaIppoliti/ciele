"use client";

import { useMemo, useState } from "react";
import { MessageCircle, Search } from "lucide-react";
import { groupByDay, relativeShort } from "@/lib/history-groups";

export interface HistoryMenuEntry {
  id: string;
  label: string;
  updatedAt: string;
}

/**
 * A chat's past conversations as a menu under its header (Notion's), rather
 * than a panel that replaces the transcript: the thread stays on screen while
 * you look for another, and picking one swaps it in place.
 *
 * Grouped by day like every history in the console, newest first, with a
 * filter for a long one. It is the content of the `ChatHeader`'s history
 * popover, which owns closing on Escape and on a press outside; the host
 * closes it on a pick.
 */
export function ThreadHistoryMenu({
  entries,
  activeId,
  disabled,
  onPick,
}: {
  entries: readonly HistoryMenuEntry[];
  activeId: string | null;
  /** While a turn streams, switching would let it write into the wrong thread. */
  disabled: boolean;
  onPick: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);

  const needle = query.trim().toLowerCase();
  const groups = useMemo(
    () =>
      groupByDay(
        needle ? entries.filter((entry) => entry.label.toLowerCase().includes(needle)) : entries
      ),
    [entries, needle]
  );

  return (
    <>
      {searching && (
        <div className="relative border-b p-2">
          <Search className="text-muted-foreground absolute top-1/2 left-4 size-3.5 -translate-y-1/2" />
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search conversations…"
            aria-label="Search conversations"
            className="bg-transparent w-full rounded-md py-1.5 pr-2 pl-7 text-sm outline-none"
          />
        </div>
      )}
      <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto p-1.5">
        {entries.length === 0 ? (
          <p className="text-muted-foreground px-3 py-6 text-center text-sm">No conversations yet</p>
        ) : groups.length === 0 ? (
          <p className="text-muted-foreground px-3 py-6 text-center text-sm">Nothing matches</p>
        ) : (
          groups.map((group, index) => (
            <div key={group.id}>
              <div className="text-muted-foreground flex h-8 items-center px-2.5 text-xs font-medium">
                <span className="flex-1">{group.label}</span>
                {index === 0 && !searching && (
                  <button
                    type="button"
                    aria-label="Search conversations"
                    onClick={() => setSearching(true)}
                    className="press-control hover:bg-foreground/[0.07] hover:text-foreground -mr-1 flex size-6 items-center justify-center rounded-md"
                  >
                    <Search className="size-3.5" />
                  </button>
                )}
              </div>
              {group.entries.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  disabled={disabled}
                  aria-current={entry.id === activeId ? "true" : undefined}
                  onClick={() => onPick(entry.id)}
                  className={`press flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-sm transition-colors disabled:opacity-50 ${
                    entry.id === activeId ? "bg-foreground/[0.1]" : "hover:bg-foreground/[0.07]"
                  }`}
                >
                  <MessageCircle className="text-muted-foreground size-4 shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{entry.label}</span>
                  <span className="text-muted-foreground shrink-0 text-xs">
                    {relativeShort(entry.updatedAt)}
                  </span>
                </button>
              ))}
            </div>
          ))
        )}
      </div>
    </>
  );
}
