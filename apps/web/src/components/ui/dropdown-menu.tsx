"use client";

import * as React from "react";
import { Menu as MenuPrimitive } from "@base-ui/react/menu";

import { cn } from "@/lib/utils";
import { useSlidingPill } from "@/components/ui/hover-highlight";
import { useOpenChangeFeedback } from "@agent-hub/ui/feedback";

/** The row the sliding highlight pill tracks. */
const MENU_ROW_SELECTOR = '[data-slot="dropdown-menu-item"]';

function DropdownMenu({ onOpenChange, ...props }: MenuPrimitive.Root.Props) {
  const onOpenChangeWithFeedback = useOpenChangeFeedback(onOpenChange);
  return (
    <MenuPrimitive.Root
      data-slot="dropdown-menu"
      onOpenChange={onOpenChangeWithFeedback}
      {...props}
    />
  );
}

function DropdownMenuTrigger({ ...props }: MenuPrimitive.Trigger.Props) {
  return <MenuPrimitive.Trigger data-slot="dropdown-menu-trigger" {...props} />;
}

function DropdownMenuContent({
  align = "start",
  alignOffset = 0,
  side = "bottom",
  sideOffset = 4,
  className,
  children,
  ...props
}: MenuPrimitive.Popup.Props &
  Pick<
    MenuPrimitive.Positioner.Props,
    "align" | "alignOffset" | "side" | "sideOffset"
  >) {
  // Base UI highlights menu rows by moving real focus to them (mouse and
  // keyboard alike), so the sliding pill tracks focusin instead of hover.
  const { show, hide, reset, pillNode } = useSlidingPill(
    "rounded-md bg-accent",
  );
  // The popup unmounts on close; forget the pill on every fresh mount so a
  // reopen doesn't slide in from a stale position.
  const popupRef = React.useCallback(
    (node: HTMLElement | null) => {
      if (node) reset();
    },
    [reset],
  );
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Positioner
        className="isolate z-50 outline-none"
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
      >
        <MenuPrimitive.Popup
          data-slot="dropdown-menu-content"
          className={cn(
            "relative z-50 max-h-(--available-height) w-(--anchor-width) min-w-32 origin-(--transform-origin) overflow-x-hidden overflow-y-auto rounded-xl bg-popover p-1 text-popover-foreground shadow-strong ring-1 ring-alpha-medium duration-100 outline-none data-[side=bottom]:slide-in-from-top-2 data-[side=inline-end]:slide-in-from-left-2 data-[side=inline-start]:slide-in-from-right-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:overflow-hidden data-closed:fade-out-0 data-closed:zoom-out-95",
            className,
          )}
          {...props}
          ref={popupRef}
          onFocus={(event) => {
            const row = (event.target as HTMLElement).closest<HTMLElement>(
              MENU_ROW_SELECTOR,
            );
            // Destructive rows keep their own tinted focus background.
            if (
              row &&
              event.currentTarget.contains(row) &&
              row.dataset.variant !== "destructive"
            ) {
              show(row);
            } else {
              hide();
            }
          }}
          onBlur={(event) => {
            if (
              !event.currentTarget.contains(event.relatedTarget as Node | null)
            ) {
              hide();
            }
          }}
        >
          {pillNode}
          {children}
        </MenuPrimitive.Popup>
      </MenuPrimitive.Positioner>
    </MenuPrimitive.Portal>
  );
}

function DropdownMenuLabel({
  className,
  inset,
  ...props
}: MenuPrimitive.GroupLabel.Props & {
  inset?: boolean;
}) {
  // Base UI requires GroupLabel to live inside a Menu.Group, wrap one here
  // so the label keeps working standalone at call sites.
  return (
    <MenuPrimitive.Group>
      <MenuPrimitive.GroupLabel
        data-slot="dropdown-menu-label"
        data-inset={inset}
        className={cn(
          "px-1.5 py-1 text-xs font-medium text-muted-foreground data-inset:pl-7",
          className,
        )}
        {...props}
      />
    </MenuPrimitive.Group>
  );
}

function DropdownMenuItem({
  className,
  inset,
  variant = "default",
  ...props
}: MenuPrimitive.Item.Props & {
  inset?: boolean;
  variant?: "default" | "destructive";
}) {
  return (
    <MenuPrimitive.Item
      data-slot="dropdown-menu-item"
      data-foley-click=""
      data-inset={inset}
      data-variant={variant}
      className={cn(
        "group/dropdown-menu-item relative flex cursor-default items-center gap-1.5 rounded-md px-1.5 py-1 text-sm outline-hidden select-none focus:text-accent-foreground not-data-[variant=destructive]:focus:**:text-accent-foreground data-inset:pl-7 data-[variant=destructive]:text-destructive data-[variant=destructive]:focus:bg-destructive/10 data-[variant=destructive]:focus:text-destructive dark:data-[variant=destructive]:focus:bg-destructive/20 data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 data-[variant=destructive]:*:[svg]:text-destructive",
        className,
      )}
      {...props}
    />
  );
}

function DropdownMenuSeparator({
  className,
  ...props
}: MenuPrimitive.Separator.Props) {
  return (
    <MenuPrimitive.Separator
      data-slot="dropdown-menu-separator"
      className={cn("-mx-1 my-1 h-px bg-border", className)}
      {...props}
    />
  );
}

export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuSeparator,
};
