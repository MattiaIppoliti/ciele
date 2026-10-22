"use client";

import type { CSSProperties } from "react";
import { Check, ChevronDown, History } from "lucide-react";
import { Button as CieleButton } from "@agent-hub/ui";
import type { Teammate } from "@agent-hub/core";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TeammateAvatar } from "@/components/teammates/teammate-avatar";
import { relativeShort } from "@/lib/history-groups";

/** A face the empty chat's picker can switch to. */
export type PickableTeammate = Pick<
  Teammate,
  "id" | "name" | "title" | "avatarSeed" | "systemKind"
>;

/**
 * The strip's pills: round, and tight on the icon side so the icon sits on the
 * strip's own inset rather than a button's width in from it. Inline, because
 * button.css is unlayered and outranks Tailwind's padding and radius.
 */
const PILL = {
  "--radius": "9999px",
  paddingInline: "0.375rem 0.625rem",
} as CSSProperties;

/**
 * Who this chat is with, under an empty chat's composer: the face and name of
 * the Teammate, and a menu of the others on this Member's roster. Picking one
 * opens that Teammate's own empty chat.
 */
export function TeammatePicker({
  current,
  teammates,
  onPick,
}: {
  current: PickableTeammate;
  teammates: readonly PickableTeammate[];
  onPick: (teammate: PickableTeammate) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <CieleButton variant="ghost" size="sm" type="button" style={PILL}
            aria-label={`Teammate: ${current.name}`}
            icon={<TeammateAvatar teammate={current} className="size-4" />}
            iconRight={<ChevronDown />}
            className="min-w-0"
          />
        }
      >
        <span className="truncate">{current.name}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" sideOffset={8} className="w-64">
        <DropdownMenuLabel>Teammates</DropdownMenuLabel>
        {teammates.map((teammate) => (
          <DropdownMenuItem
            key={teammate.id}
            onClick={() => {
              if (teammate.id !== current.id) onPick(teammate);
            }}
            className="gap-2 py-1.5"
          >
            <TeammateAvatar teammate={teammate} className="size-5" />
            <span className="min-w-0 flex-1">
              <span className="block truncate">{teammate.name}</span>
              {teammate.title ? (
                <span className="text-muted-foreground block truncate text-xs">
                  {teammate.title}
                </span>
              ) : null}
            </span>
            {teammate.id === current.id ? <Check className="text-muted-foreground" /> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * This Member's past conversations with the Teammate, at the strip's right:
 * newest first, title and how long ago. The chat header holds the full history
 * once a conversation is open; an empty chat has no header, so it is here.
 */
export function RecentConversationsMenu({
  entries,
  disabled,
  onPick,
}: {
  entries: ReadonlyArray<{ id: string; label: string; updatedAt: string }>;
  /** While a turn streams, switching would let it write into the wrong thread. */
  disabled: boolean;
  onPick: (id: string) => void;
}) {
  const recent = [...entries]
    .sort((a, b) => (a.updatedAt > b.updatedAt ? -1 : 1))
    .slice(0, 8);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <CieleButton variant="ghost" size="sm" type="button" style={PILL}
            icon={<History />}
            className="ms-auto"
          />
        }
      >
        History
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="end" sideOffset={8} className="w-64">
        <DropdownMenuLabel>Recent conversations</DropdownMenuLabel>
        {recent.length === 0 ? (
          <p className="text-muted-foreground px-1.5 py-1 text-sm">No conversations yet</p>
        ) : (
          recent.map((entry) => (
            <DropdownMenuItem
              key={entry.id}
              disabled={disabled}
              onClick={() => onPick(entry.id)}
              className="gap-3"
            >
              <span className="min-w-0 flex-1 truncate">{entry.label}</span>
              <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                {relativeShort(entry.updatedAt)}
              </span>
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
