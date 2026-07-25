"use client";

import { useState } from "react";
import { ChevronRight, Search } from "lucide-react";
import { Link } from "@/components/ui/link";
import type { AssistantSummary } from "@/components/shell/nav";

/**
 * Vercel's "Choose a project to continue" list: search + assistants, each
 * landing on the requested SETUP section of that assistant.
 */
export function SetupPicker({
  slug,
  assistants,
}: {
  slug: string;
  assistants: AssistantSummary[];
}) {
  const [query, setQuery] = useState("");

  const filtered = assistants.filter((assistant) =>
    `${assistant.title} ${assistant.nickname}`
      .toLowerCase()
      .includes(query.toLowerCase())
  );

  return (
    <div className="w-full">
      <div className="border-input bg-background flex items-center gap-2 rounded-lg border px-3 shadow-xs">
        <Search className="text-muted-foreground size-4 shrink-0" />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Find Assistant..."
          className="placeholder:text-muted-foreground h-11 w-full bg-transparent text-sm outline-none"
        />
      </div>

      <div className="mt-4 flex flex-col gap-1">
        {filtered.map((assistant) => (
          <Link
            key={assistant.id}
            href={`/assistants/${assistant.id}/${slug}`}
            className="group hover:bg-muted flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors"
          >
            <span className="bg-primary/80 size-4 shrink-0 rounded-full" />
            <span className="min-w-0 flex-1">
              <span className="block truncate">{assistant.title}</span>
              {assistant.nickname && (
                <span className="text-muted-foreground block truncate text-xs font-normal">
                  {assistant.nickname}
                </span>
              )}
            </span>
            <ChevronRight className="text-muted-foreground size-4 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />
          </Link>
        ))}
        {filtered.length === 0 && (
          <p className="text-muted-foreground py-8 text-center text-sm">
            {assistants.length === 0
              ? "No assistants yet — create one first."
              : `No assistants match “${query}”.`}
          </p>
        )}
      </div>
    </div>
  );
}
