"use client";

import { useRef } from "react";
import { Search, X } from "lucide-react";
import { Button as CieleButton, Input } from "@agent-hub/ui";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./select";
import { useTableChange } from "./table-history";

export function TableFilter({ label, value, anyLabel, options, onChange }: {
  label: string;
  value: string;
  anyLabel: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  const change = useTableChange(value, onChange, `Filter ${label.toLowerCase()}`);
  return <Select compact value={value || "__all"} onValueChange={(next) => change(next === "__all" ? "" : next)}>
    <SelectTrigger aria-label={`Filter by ${label.toLowerCase()}`} data-table-filter-active={Boolean(value) || undefined} className="press-control h-7 w-auto min-w-28 max-w-56 rounded-full bg-table-sheet text-xs">
      <SelectValue />
    </SelectTrigger>
    <SelectContent className="bg-table-sheet">
      <SelectItem value="__all">{anyLabel}</SelectItem>
      {options.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
    </SelectContent>
  </Select>;
}

export function TableSearch({ label, value, onChange }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const change = useTableChange(value, onChange, "Search rows");
  const input = useRef<HTMLInputElement>(null);
  return <div data-slot="table-search" className="relative w-48 min-w-40 max-w-full">
    <Search aria-hidden="true" className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
    <Input ref={input} type="search" aria-label={label} placeholder="Search" autoComplete="off" value={value}
      onChange={(event) => change(event.target.value)} className="h-7 rounded-full border-border bg-table-sheet pr-8 pl-8 text-xs md:text-xs" />
    {value && <CieleButton variant="ghost" size="icon-sm" type="button" aria-label={`Clear ${label.toLowerCase()}`}
      onClick={() => { change(""); input.current?.focus(); }}
      className="press-control text-muted-foreground hover:bg-alpha-light hover:text-foreground focus-visible:outline-ring absolute inset-y-0.5 right-0.5 inline-flex size-6 items-center justify-center rounded-full focus-visible:outline-2">
      <X aria-hidden="true" className="size-3.5" />
    </CieleButton>}
  </div>;
}
