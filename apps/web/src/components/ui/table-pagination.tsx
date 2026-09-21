"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  PAGE_SIZE_OPTIONS,
  countLabel,
  pageWindow,
} from "@/lib/pagination";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

/**
 * The bar at the foot of a table card: which slice is on screen, how big a
 * page is, and where you are in the set.
 *
 * It is one component rather than a prop on the table because the three
 * numbers come from wherever the table's data does. Server-paged tables bind
 * them to URL search params, client-paged ones to state, and a table that does
 * not page at all passes only `total` and gets the count on its own.
 */
export function TablePagination({
  page,
  pageSize,
  total,
  noun,
  pluralNoun,
  onPageChange,
  onPageSizeChange,
  className,
}: {
  /** Omit on a table that shows everything; the bar then states the count only. */
  page?: number;
  pageSize?: number;
  total: number;
  /** The thing being counted, singular: "campaign", "website", "member". */
  noun: string;
  /** Only where adding an "s" is wrong ("entry" → "entries"). */
  pluralNoun?: string;
  onPageChange?: (page: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
  className?: string;
}) {
  const paged = page !== undefined && pageSize !== undefined;
  const window = pageWindow(page ?? 1, pageSize ?? total ?? 1, total);
  const current = Math.min(Math.max(1, page ?? 1), window.pageCount);

  return (
    <div
      className={cn(
        "text-muted-foreground flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-2.5 text-sm",
        className
      )}
    >
      <div className="flex items-center gap-3">
        <span>
          {total === 0
            ? `No ${pluralNoun ?? `${noun}s`}`
            : paged
              ? `Showing ${window.from}–${window.to} of ${countLabel(total, noun, pluralNoun)}`
              : `Showing ${countLabel(total, noun, pluralNoun)}`}
        </span>
        {onPageSizeChange && pageSize !== undefined && (
          <Select
            value={String(pageSize)}
            onValueChange={(value) => onPageSizeChange(Number(value))}
          >
            <SelectTrigger
              aria-label="Rows per page"
              className="h-7 w-auto gap-1 border-0 bg-transparent px-2 shadow-none"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAGE_SIZE_OPTIONS.map((size) => (
                <SelectItem key={size} value={String(size)}>
                  {size}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {paged && (
        <div className="flex items-center gap-1">
          {onPageChange && window.pageCount > 1 && (
            <button
              type="button"
              aria-label="Previous page"
              disabled={current <= 1}
              onClick={() => onPageChange(current - 1)}
              className="press-control hover:text-foreground focus-visible:outline-ring inline-flex size-7 items-center justify-center rounded-md transition-colors focus-visible:outline-2 disabled:pointer-events-none disabled:opacity-40"
            >
              <ChevronLeft className="size-4" />
            </button>
          )}
          <span className="tabular-nums">
            Page {current} of {window.pageCount}
          </span>
          {onPageChange && window.pageCount > 1 && (
            <button
              type="button"
              aria-label="Next page"
              disabled={current >= window.pageCount}
              onClick={() => onPageChange(current + 1)}
              className="press-control hover:text-foreground focus-visible:outline-ring inline-flex size-7 items-center justify-center rounded-md transition-colors focus-visible:outline-2 disabled:pointer-events-none disabled:opacity-40"
            >
              <ChevronRight className="size-4" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
