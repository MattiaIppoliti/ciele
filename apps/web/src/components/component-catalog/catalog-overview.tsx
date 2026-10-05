"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, ArrowUpRight, Search } from "lucide-react";
import { Button, Input } from "@agent-hub/ui";
import { CATALOG_GROUPS, COMPONENT_FAMILIES, catalogPath, type ComponentFamily } from "./catalog";

export function CatalogOverview({ kind = "component" }: { kind?: ComponentFamily["kind"] }) {
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState("All");
  const entries = COMPONENT_FAMILIES.filter((family) => family.kind === kind);
  const categories = CATALOG_GROUPS.filter((category) => entries.some((family) => family.group === category));
  const visible = entries.filter((family) => (group === "All" || family.group === group) && `${family.title} ${family.description} ${family.variants.join(" ")}`.toLowerCase().includes(query.toLowerCase().trim()));
  const isBlock = kind === "block";
  const title = isBlock ? "Blocks" : "Components";
  const noun = isBlock ? "block" : "component";

  return (
    <>
      <div className="mb-8 max-w-2xl">
        <p className="mb-2 text-xs text-muted-foreground">Ciele design system</p>
        <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted-foreground">{isBlock
          ? "Complete features composed from the same components: tables, conversations, editors, and settings. Try the full interaction before reading the implementation."
          : "One component per page. Explore its states and variants, try the controls, and read the implementation used by Ciele."}</p>
        <Link href={isBlock ? "/components" : "/components/blocks"} className="press-text mt-4 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">{isBlock ? "Explore individual components" : "Explore complete blocks"}<ArrowRight className="size-3.5" aria-hidden="true" /></Link>
      </div>
      <div className="mb-6 space-y-3">
        <div className="relative max-w-md"><Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-muted-foreground" aria-hidden="true" /><Input type="search" placeholder={`Find a ${noun} or variant…`} aria-label={`Filter ${title.toLowerCase()}`} className="h-9 pl-9" value={query} onChange={(event) => setQuery(event.target.value)} /></div>
        <div aria-label={`Filter ${noun} category`} className="flex flex-wrap gap-1">{["All", ...categories].map((category) => <Button key={category} size="sm" variant={group === category ? "secondary" : "ghost"} aria-pressed={group === category} onClick={() => setGroup(category)}>{category}</Button>)}</div>
      </div>
      <div role="status" className="mb-3 text-xs text-muted-foreground">{visible.length} {noun}{visible.length === 1 ? "" : "s"}{group === "All" ? "" : ` in ${group}`}</div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {visible.map((family) => <Link key={family.slug} href={catalogPath(family)} prefetch={false} data-catalog-entry={family.slug} className="press group flex min-h-40 flex-col rounded-xl bg-alpha-lighter p-4 transition-colors duration-150 hover:bg-alpha-light">
          <div className="flex items-center justify-between gap-3"><h2 className="text-sm font-semibold">{family.title}</h2><ArrowUpRight className="size-3.5 shrink-0 text-muted-foreground group-hover:text-foreground" aria-hidden="true" /></div>
          <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-muted-foreground">{family.description}</p>
          <span className="mt-auto pt-4 text-2xs text-muted-foreground">{family.group}</span>
        </Link>)}
      </div>
      {!visible.length && <div className="py-10 text-center"><p className="text-sm font-medium">No {title.toLowerCase()} found</p><p className="mt-2 text-sm text-muted-foreground">Try another name or choose a different category.</p><Button className="mt-4" variant="outline" onClick={() => { setQuery(""); setGroup("All"); }}>Clear filters</Button></div>}
    </>
  );
}
