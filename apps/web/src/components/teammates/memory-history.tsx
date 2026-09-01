"use client";

import type { ReactNode } from "react";
import type { MemoryDocumentChange } from "@agent-hub/core";
import { formatDateTime } from "@/lib/format";
import {
  historyAuthor,
  historyChangeSummary,
  historyNote,
} from "@/lib/teammates/memory-copy";

/**
 * The history of writes to one memory document: who, when, and what changed
 * (#771; #767 stories 19 and 24).
 *
 * One component for both layers that expose a history, the Member's own
 * profile and a Project's decisions, because they are the same list with the
 * same three questions and only the actions beside a row differ. The Member's
 * own document gets an undo, a Project's does not: reverting is defined only
 * for the layer whose owner is unambiguously the person looking at it.
 *
 * The change text sits behind a disclosure rather than in the row. "Why does it
 * think that" needs the words, but a page of prose per row would bury the list
 * that answers "when did this start".
 */
export function MemoryHistory({
  changes,
  teammateNames,
  emptyHint,
  renderAction,
}: {
  changes: readonly MemoryDocumentChange[];
  /** Teammate id → name, so a write is attributed to a colleague, not an id. */
  teammateNames: Readonly<Record<string, string>>;
  emptyHint: string;
  /** An action for the row, e.g. undo. Omitted where there is nothing to offer. */
  renderAction?: (change: MemoryDocumentChange) => ReactNode;
}) {
  if (changes.length === 0) {
    return <p className="text-muted-foreground text-sm">{emptyHint}</p>;
  }

  return (
    <ul className="divide-y rounded-lg border">
      {changes.map((change) => {
        const { entry, before, after } = change;
        return (
          <li
            key={entry.id}
            className="flex items-start gap-3 px-3 py-2.5 text-sm"
          >
            <div className="min-w-0 flex-1">
              <p className="font-medium">
                {historyAuthor({ entry, teammateNames })}
                <span className="text-muted-foreground font-normal">
                  {" · "}
                  {formatDateTime(entry.createdAt)}
                  {" · "}
                  {historyChangeSummary(change)}
                </span>
              </p>
              <p className="text-muted-foreground truncate">
                {historyNote(entry)}
              </p>
              {before !== after && (
                <details className="mt-1.5">
                  <summary className="text-muted-foreground cursor-pointer text-xs hover:underline">
                    What changed
                  </summary>
                  <div className="mt-1.5 space-y-1.5">
                    <div>
                      <p className="text-muted-foreground text-xs font-medium">
                        Before
                      </p>
                      <pre className="bg-muted/40 text-muted-foreground max-h-40 overflow-auto rounded px-2 py-1.5 text-xs whitespace-pre-wrap">
                        {before || "(empty)"}
                      </pre>
                    </div>
                    <div>
                      <p className="text-muted-foreground text-xs font-medium">
                        After
                      </p>
                      <pre className="bg-muted/40 max-h-40 overflow-auto rounded px-2 py-1.5 text-xs whitespace-pre-wrap">
                        {after || "(empty)"}
                      </pre>
                    </div>
                  </div>
                </details>
              )}
            </div>
            {renderAction?.(change)}
          </li>
        );
      })}
    </ul>
  );
}
