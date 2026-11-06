"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import type { LucideIcon } from "lucide-react";

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/motion/context-menu";

/**
 * Right-click on a table row, on the same menu component the Assistants grid
 * and the Improvements board already use.
 *
 * Every action here is one the row already offers somewhere: in the trailing
 * actions cell, behind the Open control, or in a dialog the name opens. What
 * the menu adds is reach. The actions cell holds three icon buttons at the
 * far right of a table that scrolls sideways, so on a narrow console the
 * delete for the row you are looking at is off-screen; right-click puts every
 * one of them under the pointer, wherever in the row it is.
 *
 * The items are data rather than children, because five tables declare them
 * and the ordering rules (the destructive one last, behind a rule) should
 * hold in all five rather than being re-applied by hand.
 */

export interface TableMenuAction {
  label: string;
  icon?: LucideIcon;
  /** Navigates instead of acting. */
  href?: string;
  onSelect?: () => void;
  disabled?: boolean;
  /** Red, and sorted to the bottom behind a rule. */
  destructive?: boolean;
}

/** One attribute the row's menu can set, drawn as a radio group. */
export interface TableMenuChoice {
  label: string;
  value: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  onChange: (value: string) => void;
}

export function TableRowMenu({
  title,
  actions,
  choices = [],
  onOpen,
  children,
}: {
  /** Names the row at the top of the menu, so it is clear what it acts on. */
  title: string;
  actions: Array<TableMenuAction | null | false>;
  /**
   * Attributes set in place, the same ones the row's editable cells change,
   * listed between the actions and the destructive ones.
   */
  choices?: Array<TableMenuChoice | null | false>;
  /**
   * Fires as the menu opens, before anything in it is chosen. Tables with a
   * checkbox column use it to make this row the selection: the menu is titled
   * with one name and acts on one row, so a bulk bar still claiming three
   * would be describing a different set from the one about to be acted on.
   */
  onOpen?: () => void;
  children: React.ReactElement<React.HTMLAttributes<HTMLElement>>;
}) {
  const router = useRouter();
  const present = actions.filter((a): a is TableMenuAction => Boolean(a));
  const ordinary = present.filter((a) => !a.destructive);
  const destructive = present.filter((a) => a.destructive);
  const groups = choices.filter((c): c is TableMenuChoice => Boolean(c));
  if (present.length === 0 && groups.length === 0) return children;

  const render = (action: TableMenuAction) => (
    <ContextMenuItem
      key={action.label}
      disabled={action.disabled}
      tone={action.destructive ? "destructive" : "default"}
      textValue={action.label}
      onSelect={() => {
        if (action.href) router.push(action.href);
        else action.onSelect?.();
      }}
    >
      {action.icon && <action.icon className="size-4 shrink-0" />}
      {action.label}
    </ContextMenuItem>
  );

  return (
    <ContextMenu onOpenChange={(open) => open && onOpen?.()}>
      <ContextMenuTrigger>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-56">
        <ContextMenuLabel>{title}</ContextMenuLabel>
        {ordinary.map(render)}
        {groups.map((choice, index) => (
          <React.Fragment key={choice.label}>
            {(index > 0 || ordinary.length > 0) && <ContextMenuSeparator />}
            <ContextMenuLabel>{choice.label}</ContextMenuLabel>
            <ContextMenuRadioGroup value={choice.value} onValueChange={(value) => value !== choice.value && choice.onChange(value)}>
              {choice.options.map((option) => (
                <ContextMenuRadioItem key={option.value} value={option.value} textValue={option.label}>
                  {option.label}
                </ContextMenuRadioItem>
              ))}
            </ContextMenuRadioGroup>
          </React.Fragment>
        ))}
        {destructive.length > 0 && (ordinary.length > 0 || groups.length > 0) && (
          <ContextMenuSeparator />
        )}
        {destructive.map(render)}
      </ContextMenuContent>
    </ContextMenu>
  );
}
