"use client";

import { RollInText } from "@/components/motion/roll-in-text";

import { memo } from "react";
import {
  CircleCheckBig,
  CornerDownLeft,
  FlaskConical,
  FolderKanban,
  MessageSquareText,
  MessagesSquare,
  MousePointerClick,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import { AnimatedGlyph, AnimatedIcon } from "@/components/ui/animated-icon";
import { localGlyphFor } from "@/components/ui/icons/local-glyphs";
import { opensInNewTab, type FindKind, type FindRecord } from "@/lib/find-index";
import type { MatchRanges } from "@/lib/fuzzy";

/** One selectable row: a workspace record or a page/section of the console. */
export interface FindItem {
  key: string;
  label: string;
  /** Muted text after the label: where the thing lives. */
  hint: string;
  group: string;
  icon: LucideIcon;
  href: string;
  /** Present for a workspace record, drives the preview pane. */
  record: FindRecord | null;
  /** Where the query landed in the label and in the hint, for highlighting (#1072). */
  matches?: { label: MatchRanges | null; hint: MatchRanges | null };
  /** The body around the query, for a record listed because of its body alone. */
  excerpt?: { text: string; ranges: MatchRanges };
  /** An action rather than a destination: run on select instead of navigating. */
  run?: () => void;
  /** Leave the palette open after `run` (a recent search refills the box). */
  keepOpen?: boolean;
}

/** The text with the matched letters marked. */
function Highlighted({ text, ranges }: { text: string; ranges: MatchRanges }) {
  const parts: React.ReactNode[] = [];
  let at = 0;
  ranges.forEach(([start, end], i) => {
    if (start > at) parts.push(text.slice(at, start));
    parts.push(
      <mark key={i} className="text-foreground rounded-sm bg-tone-amber px-px">
        {text.slice(start, end)}
      </mark>
    );
    at = end;
  });
  if (at < text.length) parts.push(text.slice(at));
  return <>{parts}</>;
}

/** The glyph beside a record of each kind. */
export const KIND_ICONS: Record<FindKind, LucideIcon> = {
  assistant: MessagesSquare,
  conversation: MessageSquareText,
  improvement: FlaskConical,
  help_desk: UsersRound,
  teammate: MousePointerClick,
  task: CircleCheckBig,
  project: FolderKanban,
};

/**
 * One result. Memoised on plain values, so moving the selection re-renders the
 * row that lost it and the row that gained it, not every row. Only the active
 * row carries the animated icon (a motion-driven component with its own hover
 * listeners); the rest draw the static glyph, which is what made a long list
 * slow to arrow through.
 */
export const FindRow = memo(function FindRow({
  item,
  index,
  isActive,
  optionId,
  onMove,
  onSelect,
}: {
  item: FindItem;
  index: number;
  isActive: boolean;
  optionId: string;
  onMove: (index: number, x: number, y: number) => void;
  onSelect: (item: FindItem, newTab: boolean) => void;
}) {
  const Icon = item.icon;
  const localGlyph = localGlyphFor(Icon);
  return (
    <button
      type="button"
      id={optionId}
      role="option"
      // Focus stays in the input (aria-activedescendant), so the options are
      // not tab stops of their own.
      tabIndex={-1}
      aria-selected={isActive}
      data-index={index}
      onMouseMove={(event) => onMove(index, event.clientX, event.clientY)}
      onClick={(event) => onSelect(item, opensInNewTab(event))}
      className={`relative flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
        isActive ? "text-foreground" : "text-muted-foreground"
      }`}
    >
      {!isActive ? (
        <Icon aria-hidden className="size-4 shrink-0" />
      ) : localGlyph ? (
        <AnimatedGlyph icon={localGlyph} size={16} className="shrink-0" />
      ) : (
        <AnimatedIcon icon={Icon} size={16} className="shrink-0" />
      )}
      <span className="min-w-0 flex-1 truncate">
        <span className="text-foreground font-medium">
          {item.matches?.label?.length ? (
            <Highlighted text={item.label} ranges={item.matches.label} />
          ) : (
            <RollInText text={item.label} />
          )}
        </span>
        {item.hint && (
          <span className="text-muted-foreground text-xs">
            {" · "}
            {item.matches?.hint?.length ? <Highlighted text={item.hint} ranges={item.matches.hint} /> : item.hint}
          </span>
        )}
        {item.excerpt && (
          <span className="text-muted-foreground text-xs">
            {" · "}
            <Highlighted text={item.excerpt.text} ranges={item.excerpt.ranges} />
          </span>
        )}
      </span>
      {isActive && (
        <CornerDownLeft aria-hidden className="text-muted-foreground size-3.5 shrink-0" />
      )}
    </button>
  );
});
