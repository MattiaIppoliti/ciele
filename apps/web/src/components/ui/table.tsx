"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * The card a table lives in: a tinted frame with the rows as a rounded panel
 * inset in it.
 *
 * The card used to be one flat surface with a tinted band at each end, which
 * made the header and the footer read as parts of the rows rather than as the
 * chrome around them. Here the tint is the frame: the column headings and the
 * pagination sit directly on it, on all four sides, and what it wraps is the
 * data. The rows are the only thing drawn on the card surface, and they are
 * rounded, so the table reads as a sheet held in a frame.
 *
 * The frame is its own token. It was `bg-muted/40`, which cannot work: `--muted`
 * and `--card` are the same value in every theme here, so the tint composited
 * to within a few values of the sheet and the heading band, the footer and the
 * rows all read as one surface. `--table-frame` is a step *darker* than the
 * sheet in dark mode and a darker grey than it in light mode, which is what
 * makes the inset visible at all.
 *
 * Every table in the console uses it, so the frame tone, the inset and the
 * row rhythm are decided once here instead of per page.
 */
function TableCard({
  footer,
  className,
  children,
  ...props
}: React.ComponentProps<"div"> & { footer?: React.ReactNode }) {
  return (
    <div
      data-slot="table-card"
      // `p-2`, not `p-1`: the padding is the frame, so how wide it is *is* how
      // thick the band down each side reads. At 4px it was a seam rather than
      // a border and the sheet looked like it had simply been inset by a
      // rounding error.
      className={cn(
        "bg-table-frame w-full overflow-hidden rounded-xl border p-2",
        className,
      )}
      {...props}
    >
      {children}
      {footer ? (
        <div data-slot="table-card-footer">{footer}</div>
      ) : null}
    </div>
  );
}

/**
 * The table itself.
 *
 * Two things here are the "cells, not rows" half of the console's tables.
 * Every cell draws its right border, so a row reads as a run of cells the way
 * it does in a spreadsheet rather than as one long line of text; and `fixed`
 * switches the layout to `table-fixed`, which is what makes a `<colgroup>`
 * mean anything. In `auto` layout the browser re-measures against the content
 * on every render and a dragged width is a suggestion it ignores, so a
 * resizable table passes `fixed` and renders `useColumnWidths`'s `colGroup`.
 */
function Table({
  className,
  fixed,
  empty,
  ...props
}: React.ComponentProps<"table"> & {
  fixed?: boolean;
  /**
   * No rows. The header then drops its dividers and its fixed widths: a
   * band of empty columns ruled over nothing is a grid drawn around an
   * absence, and the column boundaries say nothing until there is something
   * in them to separate.
   */
  empty?: boolean;
}) {
  return (
    <div
      data-slot="table-container"
      className="relative w-full overflow-x-auto"
    >
      <table
        data-slot="table"
        data-empty={empty ? "true" : undefined}
        className={cn(
          "w-full caption-bottom text-sm",
          // The last cell has no neighbour to divide it from, and the border
          // would sit on the card's own edge.
          "[&_td:not(:last-child)]:border-r [&_th:not(:last-child)]:border-r",
          "data-[empty=true]:table-auto data-[empty=true]:[&_th]:border-r-0",
          fixed && "table-fixed",
          className,
        )}
        {...props}
      />
    </div>
  );
}

/**
 * The column headings, on the card's frame rather than on a band of their own.
 *
 * They keep a rule under them, and that is not a leftover. The frame is
 * `bg-muted/40` and the sheet below it is `bg-card`, which would be the whole
 * separation if those were two colours, and they are not: `--card` and
 * `--muted` are the same value in both themes (`#191919` dark, `#f1f1f1`
 * light), so the tint composites to within a few values of the sheet and the
 * inset never reads. Without the rule there is nothing at all between the
 * headings and the first row. Change this only after the two tokens differ.
 */
function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return (
    <thead
      data-slot="table-header"
      // The rule goes on the cells rather than on the row, beside the `border-r`
      // dividers they already carry, so both edges of a heading come from one
      // element and cannot disagree about colour.
      //
      // `bg-transparent` on the cells, explicitly: `TableRow` paints the card
      // surface onto every cell it has, and the heading row is a `TableRow`
      // too, so without this the headings sit on the panel instead of on the
      // frame. It wins on specificity (`thead tr > *` over `tr > *`).
      className={cn(
        "[&_tr]:border-b-0 [&_tr>*]:bg-transparent",
        className,
      )}
      {...props}
    />
  );
}

/**
 * The rows, as the inset panel.
 *
 * The rounding is on the four corner *cells*, not on this element: a `tbody`
 * ignores `border-radius` under `border-collapse: collapse`, and
 * `overflow-hidden` on it clips nothing. A cell rounds when it carries its
 * own background, which is why `TableRow` paints the card surface onto its
 * cells rather than onto itself.
 *
 * `xl`, the card's own radius, rather than the `lg` that was here. A sheet
 * cornered tighter than the frame holding it reads as square next to it, and
 * the two corners are 8px apart on screen with nothing between them to
 * explain the difference.
 */
function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return (
    <tbody
      data-slot="table-body"
      className={cn(
        "[&_tr:last-child]:border-0",
        "[&>tr:first-child>*:first-child]:rounded-tl-xl",
        "[&>tr:first-child>*:last-child]:rounded-tr-xl",
        "[&>tr:last-child>*:first-child]:rounded-bl-xl",
        "[&>tr:last-child>*:last-child]:rounded-br-xl",
        // The rule between the headings and the sheet, drawn on the sheet's
        // own top edge as an inset shadow rather than as the header's
        // `border-bottom`. The table is `border-collapse: collapse`, where a
        // border ignores `border-radius`: the straight rule ran on past the
        // corner while the sheet curved away underneath it, leaving a 11px
        // stub over the frame at each end. A shadow is clipped to the
        // border-box shape, so it follows the corner round.
        "[&>tr:first-child>*]:shadow-[inset_0_1px_0_0_var(--border)]",
        className,
      )}
      {...props}
    />
  );
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn(
        "border-t bg-muted/50 font-medium [&>tr]:last:border-b-0",
        className,
      )}
      {...props}
    />
  );
}

/**
 * A row.
 *
 * Its surface is painted on its **cells**, not on the row: the panel's corners
 * are rounded by the corner cells, and a cell only rounds when the colour it
 * is clipping is its own. Hover and selection follow the same route, or they
 * would paint under a `bg-card` cell and never be seen.
 */
function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      data-slot="table-row"
      // `group/row` is what the hover controls inside a cell hang off, chiefly
      // `TableOpenCell`: they answer the row being hovered, not the cell.
      className={cn(
        "group/row border-b transition-colors",
        "[&>*]:bg-card [&>*]:transition-colors",
        "hover:[&>*]:bg-muted/50 has-aria-expanded:[&>*]:bg-muted/50",
        "data-[state=selected]:[&>*]:bg-muted",
        className,
      )}
      {...props}
    />
  );
}

/**
 * A column header.
 *
 * It carried a per-column glyph for a while. Twelve columns each with a small
 * grey icon is twelve things competing with the words next to them, and none
 * of the icons said anything the word did not; the row now reads as a row.
 * What a header carries instead is behaviour, see `TableColumnHeader`.
 */
function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      data-slot="table-head"
      // `relative` so a column's resize handle can sit on its right border.
      className={cn(
        "text-muted-foreground relative h-11 px-4 text-left align-middle text-xs font-medium whitespace-nowrap [&:has([role=checkbox])]:pr-0",
        className,
      )}
      {...props}
    />
  );
}

function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return (
    <td
      data-slot="table-cell"
      // `relative` for the hover controls a cell can carry (the Open pill),
      // `overflow-hidden` because a fixed-layout column that its content can
      // push wider is not a column the reader resized.
      className={cn(
        "relative overflow-hidden px-4 py-3 align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0",
        className,
      )}
      {...props}
    />
  );
}

function TableCaption({
  className,
  ...props
}: React.ComponentProps<"caption">) {
  return (
    <caption
      data-slot="table-caption"
      className={cn("mt-4 text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

/**
 * The row of controls in a table's trailing Actions cell.
 *
 * Filled circles rather than bare ghost icons. At the right edge of a wide
 * table these are the only controls a reader aims at without a label to read,
 * and an icon drawn straight onto the sheet gives the pointer nothing to land
 * on: the target is the glyph, which is 16px, instead of the 32px the button
 * actually accepts. The circle draws the target it already has.
 *
 * A control marked `data-destructive` is tinted before it is pressed. Delete
 * is the one action in the row that cannot be undone, and telling the reader
 * that after the click is telling them too late.
 */
function TableActions({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="table-actions"
      className={cn(
        "flex items-center justify-end gap-1.5",
        // The caller owns the buttons; this is what makes them read as one set.
        "[&_button]:text-foreground/70 [&_button]:size-8 [&_button]:rounded-full",
        "[&_button]:bg-foreground/[0.06] [&_button:hover]:bg-foreground/[0.12]",
        "[&_button:hover]:text-foreground",
        "[&_button[data-destructive]]:bg-destructive/10",
        "[&_button[data-destructive]]:text-destructive",
        "[&_button[data-destructive]:hover]:bg-destructive/20",
        // A disabled control keeps its circle but stops claiming to be one.
        "[&_button:disabled]:bg-foreground/[0.03] [&_button:disabled]:text-foreground/30",
        className,
      )}
      {...props}
    />
  );
}

export {
  Table,
  TableActions,
  TableCard,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
};
