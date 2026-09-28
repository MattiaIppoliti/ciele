"use client";

import { useState } from "react";
import { LayoutGrid, Search } from "lucide-react";
import { Check } from "lucide-react";
import { Button } from "@agent-hub/ui";
import { Popover, PopoverContent, PopoverTrigger } from "@agent-hub/ui";
import { canAutoFocus } from "@/lib/auto-focus";

const OPTION_CLASS =
  "press-control hover:bg-muted focus-visible:outline-ring flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm focus-visible:outline-2";

interface AssistantOption {
  id: string;
  title: string;
}

/**
 * Vercel-style "All Projects ⌄" control, scoped to filtering Insights by a
 * single assistant instead of navigating, search + list, current pick
 * checked.
 */
export function AssistantFilterDropdown({
  assistants,
  value,
  onChange,
}: {
  assistants: AssistantOption[];
  value: string;
  onChange: (assistantId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const selected = assistants.find((a) => a.id === value);
  const filtered = assistants.filter((a) =>
    a.title.toLowerCase().includes(query.toLowerCase())
  );

  function pick(id: string) {
    onChange(id);
    setOpen(false);
    setQuery("");
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery("");
      }}
    >
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            aria-label={`Assistant: ${selected?.title ?? "All"}`}
            className="h-10 max-w-56 rounded-lg px-4"
          />
        }
      >
        {selected ? (
          <span className="bg-primary size-3.5 shrink-0 rounded-full" />
        ) : (
          <LayoutGrid className="size-4 shrink-0" aria-hidden />
        )}
        <span className="truncate">{selected ? selected.title : "All Assistants"}</span>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start">
        {/* The input draws no outline of its own, so the row shows focus. */}
        <div className="focus-within:ring-ring/50 flex items-center gap-2 rounded-t-xl border-b px-3 focus-within:ring-2 focus-within:ring-inset">
          <Search className="text-muted-foreground size-4 shrink-0" aria-hidden />
          <input
            autoFocus={canAutoFocus()}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find Assistant…"
            aria-label="Find assistant"
            type="search"
            autoComplete="off"
            className="placeholder:text-muted-foreground h-10 w-full bg-transparent text-sm outline-none"
          />
        </div>
        <div className="max-h-72 overflow-y-auto p-1.5">
          <button
            type="button"
            aria-pressed={!value}
            onClick={() => pick("")}
            className={OPTION_CLASS}
          >
            <LayoutGrid className="text-muted-foreground size-4 shrink-0" aria-hidden />
            <span className="flex-1 truncate">All Assistants</span>
            {!value && <Check className="size-4 shrink-0" aria-hidden />}
          </button>
          {filtered.map((assistant) => (
            <button
              key={assistant.id}
              type="button"
              aria-pressed={assistant.id === value}
              onClick={() => pick(assistant.id)}
              className={OPTION_CLASS}
            >
              <span className="bg-primary/80 size-3.5 shrink-0 rounded-full" />
              <span className="flex-1 truncate">{assistant.title}</span>
              {assistant.id === value && <Check className="size-4 shrink-0" aria-hidden />}
            </button>
          ))}
          {filtered.length === 0 && (
            <p className="text-muted-foreground px-3 py-6 text-center text-sm break-words">
              {query ? `No assistants match “${query}”.` : "No assistants yet."}
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
