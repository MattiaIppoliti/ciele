"use client";

import { SquarePen } from "lucide-react";

export interface WidgetConversationSummary {
  id: string;
  title: string;
  updatedAt: string;
}

/** "Today" / "Yesterday" / "07 Jul 2025" — matches the editor preview. */
function historyDayLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Earlier";
  const startOfDay = (d: Date) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round(
    (startOfDay(new Date()) - startOfDay(date)) / 86400000
  );
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/**
 * Full-panel conversation history — the same surface the editor preview shows
 * (a "My conversations" tab, date-grouped rows, a New chat footer) so the
 * widget and preview read identically. Replaces the chat body while open
 * rather than stacking a list above it.
 *
 * For anonymous visitors this history is whatever the current browser holds
 * (keyed by the per-browser visitor id) — there is no cross-device sync.
 */
export function WidgetHistory({
  conversations,
  activeId,
  onSelect,
  onNewChat,
}: {
  conversations: WidgetConversationSummary[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNewChat: () => void;
}) {
  const sorted = [...conversations].sort((a, b) =>
    a.updatedAt > b.updatedAt ? -1 : 1
  );
  const groups: Array<{ label: string; items: WidgetConversationSummary[] }> =
    [];
  for (const c of sorted) {
    const label = historyDayLabel(c.updatedAt);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(c);
    else groups.push({ label, items: [c] });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b px-4">
        <span className="text-primary border-primary inline-block border-b-2 px-1 pt-3 pb-2 text-sm font-semibold">
          My conversations
        </span>
      </div>
      <div className="no-scrollbar flex-1 overflow-y-auto pb-2">
        {groups.length === 0 && (
          <p className="text-muted-foreground px-4 py-8 text-center text-sm">
            No previous conversations yet
          </p>
        )}
        {groups.map((group) => (
          <div key={group.label}>
            <p className="text-muted-foreground flex items-center gap-2 px-4 pt-4 pb-1.5 text-sm">
              {group.label} <span className="bg-border h-px flex-1" />
            </p>
            {group.items.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => onSelect(c.id)}
                className={`block w-full truncate px-4 py-3 text-left text-[15px] transition-colors ${
                  activeId === c.id ? "bg-primary/5" : "hover:bg-muted"
                }`}
              >
                {c.title || "Untitled conversation"}
              </button>
            ))}
          </div>
        ))}
      </div>
      <div className="flex justify-center border-t px-4 py-3">
        <button
          type="button"
          onClick={onNewChat}
          className="inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium transition-colors hover:bg-muted"
        >
          <SquarePen className="size-4" /> New chat
        </button>
      </div>
    </div>
  );
}
