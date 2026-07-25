"use client";

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Check, ChevronsUpDown, LayoutGrid, Search, X } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@agent-hub/ui";
import { Hint } from "@agent-hub/ui";
import { AnimatedIcon } from "@/components/ui/animated-icon";
import { HoverHighlight } from "@/components/ui/hover-highlight";
import { useShell } from "@/components/shell/shell-provider";
import {
  assistantIdFromPath,
  assistantSectionFromPath,
  setupHref,
} from "@/components/shell/nav";

/**
 * Vercel-style project switcher in the top bar: "All Assistants" or the
 * assistant currently in scope. Picking an assistant keeps the open SETUP
 * section when there is one, otherwise lands on its Overview.
 */
export function ScopeSwitcher() {
  const router = useRouter();
  const pathname = usePathname();
  const { assistants } = useShell();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const scopedId = assistantIdFromPath(pathname);
  const scoped = scopedId
    ? (assistants.find((a) => a.id === scopedId) ?? null)
    : null;
  const currentSection = scopedId ? assistantSectionFromPath(pathname) : null;

  const filtered = assistants.filter((a) =>
    `${a.title} ${a.nickname}`.toLowerCase().includes(query.toLowerCase())
  );

  function go(href: string) {
    setOpen(false);
    setQuery("");
    router.push(href);
  }

  return (
    <div className="flex min-w-0 items-center gap-1">
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setQuery("");
        }}
      >
        <PopoverTrigger
          render={
            <button
              type="button"
              className="hover:bg-muted flex h-8 max-w-64 items-center gap-2 rounded-lg px-2 text-sm font-medium transition-colors"
            />
          }
        >
          {scoped ? (
            scoped.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={scoped.avatarUrl}
                alt=""
                className="size-4 shrink-0 rounded-full object-cover"
              />
            ) : (
              <span className="bg-primary size-4 shrink-0 rounded-full" />
            )
          ) : (
            <AnimatedIcon
              icon={LayoutGrid}
              size={16}
              iconClassName="text-muted-foreground"
              className="shrink-0"
            />
          )}
          <span className="truncate">
            {scoped ? scoped.title : "All Assistants"}
          </span>
          <AnimatedIcon
            icon={ChevronsUpDown}
            size={14}
            iconClassName="text-muted-foreground"
            className="shrink-0"
          />
        </PopoverTrigger>
        <PopoverContent className="w-72 p-0" align="start">
        <div className="flex items-center gap-2 border-b px-3">
          <Search className="text-muted-foreground size-4 shrink-0" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find Assistant..."
            className="placeholder:text-muted-foreground h-10 w-full bg-transparent text-sm outline-none"
          />
        </div>
        <HoverHighlight className="max-h-72 overflow-y-auto p-1.5">
          <button
            type="button"
            onClick={() => go("/")}
            data-highlight-row
            className="relative flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm"
          >
            <AnimatedIcon
              icon={LayoutGrid}
              size={16}
              iconClassName="text-muted-foreground"
              className="shrink-0"
            />
            <span className="flex-1 truncate">All Assistants</span>
            {!scoped && <Check className="size-4 shrink-0" />}
          </button>
          {filtered.map((assistant) => (
            <button
              key={assistant.id}
              type="button"
              onClick={() =>
                go(
                  currentSection
                    ? setupHref(assistant.id, currentSection)
                    : `/assistants/${assistant.id}`
                )
              }
              data-highlight-row
              className="relative flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm"
            >
              {assistant.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={assistant.avatarUrl}
                  alt=""
                  className="size-4 shrink-0 rounded-full object-cover"
                />
              ) : (
                <span className="bg-primary/80 size-4 shrink-0 rounded-full" />
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate">{assistant.title}</span>
                {assistant.nickname && (
                  <span className="text-muted-foreground block truncate text-xs">
                    {assistant.nickname}
                  </span>
                )}
              </span>
              {assistant.id === scopedId && (
                <Check className="size-4 shrink-0" />
              )}
            </button>
          ))}
          {filtered.length === 0 && (
            <p className="text-muted-foreground px-3 py-6 text-center text-sm">
              No assistants match “{query}”.
            </p>
          )}
        </HoverHighlight>
        </PopoverContent>
      </Popover>

      {scoped && (
        <>
          <div className="bg-border h-5 w-px shrink-0" />
          <Hint label="Back to all assistants">
            <button
              type="button"
              aria-label="Back to all assistants"
              onClick={() => router.push("/")}
              className="text-muted-foreground hover:bg-muted hover:text-foreground flex size-7 shrink-0 items-center justify-center rounded-lg transition-colors"
            >
              <AnimatedIcon icon={X} size={16} />
            </button>
          </Hint>
        </>
      )}
    </div>
  );
}
