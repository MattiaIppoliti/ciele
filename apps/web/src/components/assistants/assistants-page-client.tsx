"use client";

import { useMemo, useState } from "react";
import type { Assistant } from "@agent-hub/core";
import {
  ArrowDownAZ,
  Clock,
  GalleryVerticalEnd,
  LayoutGrid,
  ListFilter,
  Search,
} from "lucide-react";
import { Button } from "@agent-hub/ui";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@agent-hub/ui";
import { AnimatedIcon } from "@/components/ui/animated-icon";
import { AssistantCard } from "./assistant-card";
import { CreateAssistantDialog } from "./create-assistant-dialog";

type SortKey = "updated" | "name";
type ViewMode = "grid" | "list";

/**
 * Vercel-style Projects view: one wide search box, sort filter, grid/list
 * toggle and the Add New action, over a card grid of assistants.
 */
export function AssistantsPageClient({
  assistants,
  canCreate,
  canDelete,
}: {
  assistants: Assistant[];
  canCreate: boolean;
  canDelete: boolean;
}) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("updated");
  const [view, setView] = useState<ViewMode>("grid");

  const filtered = useMemo(() => {
    const list = assistants.filter((a) =>
      `${a.title} ${a.nickname} ${a.description}`
        .toLowerCase()
        .includes(query.toLowerCase())
    );
    return [...list].sort((a, b) =>
      sort === "name"
        ? a.title.localeCompare(b.title)
        : b.updatedAt.localeCompare(a.updatedAt)
    );
  }, [assistants, query, sort]);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl px-6 py-6">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-64 flex-1">
            <Search className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search Assistants..."
              className="h-9 pl-9"
            />
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="outline"
                  size="icon-lg"
                  aria-label="Sort assistants"
                />
              }
            >
              <ListFilter className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem onClick={() => setSort("updated")}>
                <AnimatedIcon icon={Clock} size={16} /> Recent activity
                {sort === "updated" && (
                  <span className="text-muted-foreground ml-auto text-xs">
                    ✓
                  </span>
                )}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setSort("name")}>
                <ArrowDownAZ className="size-4" /> Name
                {sort === "name" && (
                  <span className="text-muted-foreground ml-auto text-xs">
                    ✓
                  </span>
                )}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <div className="border-input flex h-9 items-center rounded-lg border p-0.5">
            {(
              [
                { mode: "grid", icon: LayoutGrid, label: "Grid view" },
                { mode: "list", icon: GalleryVerticalEnd, label: "List view" },
              ] as const
            ).map(({ mode, icon: Icon, label }) => (
              <button
                key={mode}
                type="button"
                aria-label={label}
                aria-pressed={view === mode}
                onClick={() => setView(mode)}
                className={`flex h-full w-9 items-center justify-center rounded-md transition-colors ${
                  view === mode
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <AnimatedIcon icon={Icon} size={16} />
              </button>
            ))}
          </div>

          {canCreate && <CreateAssistantDialog triggerLabel="Add New..." />}
        </div>

        {view === "grid" ? (
          <div className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-3">
            {filtered.map((assistant, index) => (
              <div
                key={assistant.id}
                // Bento rhythm: every 6th card spans two columns → rows of
                // [2+1] then [1+1+1].
                className={index % 6 === 0 ? "md:col-span-2" : "col-span-1"}
              >
                <AssistantCard
                  assistant={assistant}
                  canEdit={canCreate}
                  canDelete={canDelete}
                  view="grid"
                  hasPersistentHover={index === 0}
                />
              </div>
            ))}
          </div>
        ) : (
          <div className="bg-card mt-6 divide-y rounded-xl border shadow-xs">
            {filtered.map((assistant, index) => (
              <AssistantCard
                key={assistant.id}
                assistant={assistant}
                canEdit={canCreate}
                canDelete={canDelete}
                view="list"
                hasPersistentHover={index === 0}
              />
            ))}
          </div>
        )}

        {filtered.length === 0 && (
          <p className="text-muted-foreground mt-16 text-center text-sm">
            {assistants.length === 0
              ? "No assistants yet, create your first one."
              : `No assistants match “${query}”.`}
          </p>
        )}
      </div>
    </div>
  );
}
