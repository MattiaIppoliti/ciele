"use client";

import { type ReactElement, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ImprovementListItem, ImprovementPatch } from "@agent-hub/core";
import { Maximize2, PanelRight, Search } from "lucide-react";
import { Input } from "@agent-hub/ui";
import { toast } from "sonner";
import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuItem,
  ContextMenuContent,
  ContextMenuLabel,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/motion/context-menu";
import { updateImprovementAction } from "@/app/actions";
import { fuzzyMatch } from "@/lib/fuzzy";
import { IMPROVEMENT_PRIORITIES, improvementKey } from "@/lib/improvements";
import { memberDisplayName, memberInitials } from "@/lib/members";

/** Members listed before the "…more" row sends you to the search field. */
const COLLAPSED_MEMBERS = 3;

/** `YYYY-MM-DD` (the `dueDate` storage format) `days` from today, local time. */
function dueDateIn(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const p2 = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
}

const DUE_DATE_PRESETS: Array<{ label: string; days: number }> = [
  { label: "Today", days: 0 },
  { label: "Tomorrow", days: 1 },
  { label: "In a week", days: 7 },
];

/**
 * Right-click (or long-press / Shift+F10) menu on an Improvement, shared by the
 * list rows and the Kanban cards — the same menu component the Assistants grid
 * uses, with this entity's fields instead of its actions.
 *
 * Tags offer the ones already in use across the Organization: coining a new tag
 * needs a text field, which lives in the detail panel.
 */
export function ImprovementContextMenu({
  item,
  members,
  tagOptions,
  canEdit,
  onOpenDrawer,
  onTagRemembered,
  children,
}: {
  item: ImprovementListItem;
  members: Array<{ userId: string; email: string }>;
  tagOptions: string[];
  canEdit: boolean;
  /** "Open in side panel" — the board's drawer. */
  onOpenDrawer: () => void;
  /**
   * Called with a tag as it is removed: the options come from the tags in use,
   * so without this the last card carrying a tag would take it off the menu.
   */
  onTagRemembered: (tag: string) => void;
  children: ReactElement<React.HTMLAttributes<HTMLElement>>;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [memberSearch, setMemberSearch] = useState("");
  const [searchNudged, setSearchNudged] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const key = improvementKey(item.seq);

  const needle = memberSearch.trim();
  const matchingMembers = needle
    ? members.filter(
        (m) =>
          fuzzyMatch(needle, memberDisplayName(m.email)) ||
          fuzzyMatch(needle, m.email),
      )
    : // Unsearched, the menu shows the assignee first (so the checked row is
      // always visible) and defers the rest of the roster to the search field.
      [...members].sort((a, b) =>
        a.userId === item.assigneeId
          ? -1
          : b.userId === item.assigneeId
            ? 1
            : 0,
      );
  const visibleMembers = needle
    ? matchingMembers
    : matchingMembers.slice(0, COLLAPSED_MEMBERS);
  const hiddenMemberCount = matchingMembers.length - visibleMembers.length;

  /** "…more" — hand the pointer to the search field and flash its border. */
  function nudgeSearch() {
    searchRef.current?.focus();
    setSearchNudged(true);
    setTimeout(() => setSearchNudged(false), 1200);
  }

  function persist(patch: ImprovementPatch, done: string) {
    startTransition(async () => {
      try {
        await updateImprovementAction(item.id, patch);
        toast.success(`${key} — ${done}`);
      } catch {
        toast.error(`Could not update ${key}. Please try again.`);
      }
    });
  }

  function toggleTag(tag: string, checked: boolean) {
    const next = checked
      ? [...item.tags, tag].slice(0, 5)
      : item.tags.filter((t) => t !== tag);
    if (checked && item.tags.length >= 5) {
      toast.error("An improvement can carry at most 5 tags");
      return;
    }
    if (!checked) onTagRemembered(tag);
    persist({ tags: next }, checked ? `tagged "${tag}"` : `untagged "${tag}"`);
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger disabled={isPending}>{children}</ContextMenuTrigger>
      <ContextMenuContent ariaLabel={`Actions for ${key}`} className="w-60">
        <ContextMenuItem textValue="Open in side panel" onSelect={onOpenDrawer}>
          <PanelRight className="size-4" /> Open in side panel
        </ContextMenuItem>
        <ContextMenuItem
          textValue="Open full screen"
          onSelect={() => router.push(`/improvements/${item.id}`)}
        >
          <Maximize2 className="size-4" /> Open full screen
        </ContextMenuItem>
        {!canEdit ? null : (
          <>
            <ContextMenuSeparator />
            <ContextMenuLabel>Priority</ContextMenuLabel>
            <ContextMenuRadioGroup
              value={item.priority}
              onValueChange={(value) =>
                persist(
                  { priority: value as ImprovementListItem["priority"] },
                  `priority set to ${value}`,
                )
              }
            >
              {IMPROVEMENT_PRIORITIES.map((p) => (
                <ContextMenuRadioItem
                  key={p.value}
                  value={p.value}
                  textValue={p.label}
                >
                  <p.icon className={`size-3.5 ${p.iconColor}`} />
                  {p.label}
                </ContextMenuRadioItem>
              ))}
            </ContextMenuRadioGroup>

            <ContextMenuSeparator />
            <ContextMenuLabel>Assigned to</ContextMenuLabel>
            <div className="relative px-1 pb-1.5">
              <Search className="text-muted-foreground absolute top-1/2 left-3.5 size-3.5 -translate-y-1/2" />
              <Input
                ref={searchRef}
                value={memberSearch}
                onChange={(e) => setMemberSearch(e.target.value)}
                placeholder="Search members..."
                aria-label="Search members"
                // The menu's typeahead moves focus to the matching item on every
                // keystroke, which would empty this field after one character.
                onKeyDown={(e) => {
                  if (e.key !== "Escape") e.stopPropagation();
                }}
                className={`h-8 pl-8 text-[13px] transition-shadow ${
                  searchNudged ? "border-primary ring-primary/40 ring-2" : ""
                }`}
              />
            </div>
            <ContextMenuRadioGroup
              value={item.assigneeId ?? ""}
              onValueChange={(value) =>
                persist(
                  { assigneeId: value || null },
                  value
                    ? `assigned to ${memberDisplayName(
                        members.find((m) => m.userId === value)?.email,
                      )}`
                    : "unassigned",
                )
              }
              className="no-scrollbar max-h-52 overflow-y-auto"
            >
              {!needle && (
                <ContextMenuRadioItem value="" textValue="Unassigned">
                  <span className="text-muted-foreground">Unassigned</span>
                </ContextMenuRadioItem>
              )}
              {matchingMembers.length === 0 && (
                <p className="text-muted-foreground px-2.5 py-2 text-[13px]">
                  No member matches “{memberSearch.trim()}”.
                </p>
              )}
              {visibleMembers.map((m) => (
                <ContextMenuRadioItem
                  key={m.userId}
                  value={m.userId}
                  textValue={memberDisplayName(m.email)}
                >
                  <span className="bg-primary/10 text-primary flex size-5 shrink-0 items-center justify-center rounded-full text-[9px] font-bold">
                    {memberInitials(m.email)}
                  </span>
                  <span className="truncate">{memberDisplayName(m.email)}</span>
                </ContextMenuRadioItem>
              ))}
            </ContextMenuRadioGroup>
            {hiddenMemberCount > 0 && (
              <ContextMenuItem
                textValue={`${hiddenMemberCount} more members`}
                closeOnSelect={false}
                onSelect={nudgeSearch}
                inset
              >
                <span className="text-muted-foreground">
                  …{hiddenMemberCount} more — search by name
                </span>
              </ContextMenuItem>
            )}

            {tagOptions.length > 0 && (
              <>
                <ContextMenuSeparator />
                <ContextMenuLabel>Tags</ContextMenuLabel>
                <div className="no-scrollbar max-h-52 overflow-y-auto">
                  {tagOptions.map((tag) => (
                    <ContextMenuCheckboxItem
                      key={tag}
                      checked={item.tags.includes(tag)}
                      onCheckedChange={(checked) => toggleTag(tag, checked)}
                      textValue={tag}
                      closeOnSelect={false}
                    >
                      <span className="truncate">{tag}</span>
                    </ContextMenuCheckboxItem>
                  ))}
                </div>
              </>
            )}

            <ContextMenuSeparator />
            <ContextMenuLabel>Due date</ContextMenuLabel>
            {DUE_DATE_PRESETS.map((preset) => (
              <ContextMenuItem
                key={preset.label}
                textValue={preset.label}
                inset
                onSelect={() =>
                  persist(
                    { dueDate: dueDateIn(preset.days) },
                    `due ${preset.label.toLowerCase()}`,
                  )
                }
              >
                {preset.label}
              </ContextMenuItem>
            ))}
            <ContextMenuItem
              textValue="No due date"
              inset
              disabled={!item.dueDate}
              onSelect={() => persist({ dueDate: null }, "due date cleared")}
            >
              No due date
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}
