"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * The card a table lives in: one rounded, bordered surface holding the header
 * band, the rows and the footer, with the footer separated by a rule rather
 * than floating under the card. Every table in the console uses it, so the
 * rhythm (band tone, row height, where the border sits) is decided once here
 * instead of per page.
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
      className={cn("bg-card w-full overflow-hidden rounded-xl border", className)}
      {...props}
    >
      {children}
      {footer ? (
        <div className="bg-muted/40 border-t" data-slot="table-card-footer">
          {footer}
        </div>
      ) : null}
    </div>
  );
}

function Table({ className, ...props }: React.ComponentProps<"table">) {
  return (
    <div
      data-slot="table-container"
      className="relative w-full overflow-x-auto"
    >
      <table
        data-slot="table"
        className={cn("w-full caption-bottom text-sm", className)}
        {...props}
      />
    </div>
  );
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return (
    <thead
      data-slot="table-header"
      className={cn("bg-muted/40 [&_tr]:border-b", className)}
      {...props}
    />
  );
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return (
    <tbody
      data-slot="table-body"
      className={cn("[&_tr:last-child]:border-0", className)}
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

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        "border-b transition-colors hover:bg-muted/50 has-aria-expanded:bg-muted/50 data-[state=selected]:bg-muted",
        className,
      )}
      {...props}
    />
  );
}

/**
 * A column header. `icon` is the small glyph that names the column beside its
 * label; it is a prop rather than free children so every table spaces it the
 * same way and a header without one still lines up.
 */
function TableHead({
  className,
  icon: Icon,
  children,
  ...props
}: React.ComponentProps<"th"> & {
  icon?: React.ComponentType<{ className?: string }>;
}) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        "text-muted-foreground h-11 px-4 text-left align-middle text-xs font-medium whitespace-nowrap [&:has([role=checkbox])]:pr-0",
        className,
      )}
      {...props}
    >
      {Icon ? (
        <span className="inline-flex items-center gap-1.5">
          <Icon className="size-3.5 opacity-70" aria-hidden="true" />
          {children}
        </span>
      ) : (
        children
      )}
    </th>
  );
}

function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return (
    <td
      data-slot="table-cell"
      className={cn(
        "px-4 py-3 align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0",
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

export {
  Table,
  TableCard,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
};
