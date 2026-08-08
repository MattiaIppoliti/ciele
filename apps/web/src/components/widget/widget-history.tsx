"use client";

import { Brain, MessageSquareText, SquarePen, Trash2 } from "lucide-react";
import { AISidebar, type SidebarResource } from "@/components/agents/ai-sidebar";

export interface WidgetConversationSummary {
  id: string;
  title: string;
  updatedAt: string;
}

/** One remembered fact shown in the Memory folder (#666). */
export interface WidgetMemory {
  id: string;
  text: string;
  createdAt: string;
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
 * Full-panel conversation history — the beui AI Sidebar showing only the
 * visitor's conversations (date-grouped folders, most recent first), with the
 * same "My conversations" framing and New chat footer as before. Replaces the
 * chat body while open rather than stacking a list above it.
 *
 * For anonymous visitors this history is whatever the current browser holds
 * (keyed by the per-browser visitor id) — there is no cross-device sync.
 */
export function WidgetHistory({
  conversations,
  activeId,
  onSelect,
  onNewChat,
  memoryFolder,
}: {
  conversations: WidgetConversationSummary[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNewChat: () => void;
  /**
   * The Memory folder (#666): present only for SSO-signed users of an org
   * with long-term memory on — anonymous visitors never receive one.
   */
  memoryFolder?: {
    memories: WidgetMemory[];
    onDelete: (id: string) => void;
  } | null;
}) {
  const sorted = [...conversations].sort((a, b) =>
    a.updatedAt > b.updatedAt ? -1 : 1
  );
  const groups: SidebarResource[] = [];
  for (const c of sorted) {
    const label = historyDayLabel(c.updatedAt);
    const row: SidebarResource = {
      id: c.id,
      label: c.title || "Untitled conversation",
      kind: "file",
    };
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.children?.push(row);
    else
      groups.push({
        id: `day:${label}`,
        label,
        kind: "folder",
        children: [row],
      });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b px-4">
        <span className="text-primary border-primary inline-block border-b-2 px-1 pt-3 pb-2 text-sm font-semibold">
          My conversations
        </span>
      </div>
      <div className="no-scrollbar flex-1 overflow-y-auto px-2 py-2">
        {groups.length === 0 ? (
          <p className="text-muted-foreground px-4 py-8 text-center text-sm">
            No previous conversations yet
          </p>
        ) : (
          <AISidebar
            items={groups}
            activeId={activeId}
            defaultExpandedIds={groups.map((group) => group.id)}
            onActiveChange={(id) => {
              // Day-group folders toggle; only conversation rows navigate.
              if (!id.startsWith("day:")) onSelect(id);
            }}
            renderIcon={(item) =>
              item.kind === "file" ? (
                <MessageSquareText className="size-4" />
              ) : undefined
            }
            ariaLabel="My conversations"
            // Conversations only: no per-row actions menu in the widget (the
            // sidebar component has no prop to turn its rename menu off).
            className='w-full [&_button[aria-label^="Actions for"]]:hidden'
          />
        )}
        {memoryFolder && (
          <div className="mt-4">
            <div className="bg-border mx-4 h-px" />
            <p className="text-muted-foreground flex items-center gap-2 px-4 pt-4 pb-1.5 text-sm">
              <Brain className="size-4" /> Memory
            </p>
            {memoryFolder.memories.length === 0 ? (
              <p className="text-muted-foreground px-4 py-2 text-sm">
                Nothing remembered yet.
              </p>
            ) : (
              <ul>
                {memoryFolder.memories.map((memory) => (
                  <li
                    key={memory.id}
                    className="group flex items-start justify-between gap-3 px-4 py-2 text-[15px]"
                  >
                    <span className="min-w-0">{memory.text}</span>
                    <button
                      type="button"
                      onClick={() => memoryFolder.onDelete(memory.id)}
                      aria-label="Forget this"
                      className="text-muted-foreground hover:text-destructive shrink-0 pt-0.5 opacity-60 transition-opacity group-hover:opacity-100"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
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
