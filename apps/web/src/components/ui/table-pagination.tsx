"use client";

import { Button as CieleButton } from "@agent-hub/ui";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  PAGE_SIZE_OPTIONS,
  pageNumbers,
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

/** Numbered navigation shared by URL-paged and locally paged tables. */
export function TablePagination({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  className,
}: {
  /** Omit on a table that shows everything; it has a single page. */
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
  const window = pageWindow(page ?? 1, pageSize ?? Math.max(1, total), total);
  const current = Math.min(Math.max(1, page ?? 1), window.pageCount);
  const control = "press-control hover:bg-accent hover:text-foreground focus-visible:outline-ring inline-flex h-9 items-center justify-center gap-1.5 rounded-full px-3 text-sm transition-colors focus-visible:outline-2 disabled:pointer-events-none disabled:opacity-40";

  return (
    <div className={cn("text-muted-foreground flex flex-wrap items-center justify-center gap-3 px-3 py-3", className)}>
      <nav data-slot="table-page-controls" aria-label="Table pages" className="flex flex-wrap items-center justify-center gap-1">
        <CieleButton variant="ghost" size="sm" type="button" aria-label="Previous page" disabled={!onPageChange || current <= 1}
          onClick={() => onPageChange?.(current - 1)} className={control}>
          <ChevronLeft aria-hidden="true" className="size-4" /><span className="hidden sm:inline">Previous</span>
        </CieleButton>
        {pageNumbers(current, window.pageCount).map((item) => typeof item === "number" ? (
          <CieleButton variant="ghost" size="icon-sm" key={item} type="button" aria-label={`Page ${item}`} aria-current={current === item ? "page" : undefined}
            onClick={() => onPageChange?.(item)} disabled={!onPageChange && current !== item}
            className={cn(control, "size-9 px-0 tabular-nums", current === item && "bg-table-sheet text-foreground ring-border ring-1")}>
            {item}
          </CieleButton>
        ) : <span key={item} aria-hidden="true" className="px-1">…</span>)}
        <CieleButton variant="ghost" size="sm" type="button" aria-label="Next page" disabled={!onPageChange || current >= window.pageCount}
          onClick={() => onPageChange?.(current + 1)} className={control}>
          <span className="hidden sm:inline">Next</span><ChevronRight aria-hidden="true" className="size-4" />
        </CieleButton>
      </nav>
      {onPageSizeChange && pageSize !== undefined && (
        <Select compact value={String(pageSize)} onValueChange={(value) => onPageSizeChange(Number(value))}>
          <SelectTrigger aria-label="Rows per page" className="press-control h-9 w-auto gap-2 rounded-full bg-table-sheet px-3 text-xs">
            <SelectValue><span>{pageSize} per page</span></SelectValue>
          </SelectTrigger>
          <SelectContent side="top" className="bg-table-sheet">
            {PAGE_SIZE_OPTIONS.map((size) => <SelectItem key={size} value={String(size)}>{size}</SelectItem>)}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}
