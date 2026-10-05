"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import {
  Boxes, Check, ChevronRight, FormInput, Layers, LayoutDashboard,
  MessagesSquare, PanelLeft, Search, Table2, WandSparkles, type LucideIcon,
} from "lucide-react";
import { Button, Hint, Input, cn } from "@agent-hub/ui";
import { useTheme } from "@/components/theme-provider";
import { NavSection } from "@/components/shell/nav-tree";
import { ROW_IDLE } from "@/components/shell/sidebar-row";
import type { SidebarContentOptions } from "@/components/shell/sidebar-frame";
import { AnimatedIcon } from "@/components/ui/animated-icon";
import { HoverHighlight } from "@/components/ui/hover-highlight";
import { SidebarToggleIcon } from "@/components/ui/sidebar-toggle-icon";
import { CATALOG_GROUPS, COMPONENT_FAMILIES, catalogPath } from "./catalog";

const groupIcons: Record<string, LucideIcon> = {
  Foundations: Boxes,
  Forms: FormInput,
  Navigation: PanelLeft,
  Surfaces: Layers,
  "Data display": Table2,
  "AI & chat": MessagesSquare,
  Motion: WandSparkles,
  Overview: LayoutDashboard,
  Analytics: Table2,
};

export function CatalogSidebar({
  collapsed, toggleLabel, onToggle, pathname, query, setQuery, onNavigate,
}: SidebarContentOptions & {
  pathname: string;
  query: string;
  setQuery: (query: string) => void;
  onNavigate: () => void;
}) {
  const [toggleHovered, setToggleHovered] = useState(false);
  const kind = pathname.startsWith("/components/blocks") ? "block" : "component";
  const title = kind === "block" ? "Blocks" : "Components";
  const overviewPath = kind === "block" ? "/components/blocks" : "/components";
  const entries = COMPONENT_FAMILIES.filter((family) => family.kind === kind);
  const searchRef = useRef<HTMLInputElement>(null);
  const { colorPalette, setColorPalette } = useTheme();
  const current = entries.find((family) => pathname === catalogPath(family));
  const visible = entries.filter((family) =>
    `${family.title} ${family.kind} ${family.description} ${family.variants.join(" ")}`
      .toLowerCase().includes(query.toLowerCase().trim()),
  );

  function row(href: string, label: string, Icon: LucideIcon, active: boolean, count?: number) {
    const link = (
      <Link
        href={href}
        prefetch={false}
        aria-label={label}
        aria-current={active ? "page" : undefined}
        data-highlight-row
        onClick={onNavigate}
        className={cn(
          "press relative flex h-8 items-center rounded-md text-sm font-medium transition-[color,background-color,opacity] focus-visible:outline-2 focus-visible:outline-ring focus-visible:-outline-offset-2",
          collapsed ? "w-9 justify-center self-center" : "w-full gap-2.5 px-2.5",
          active ? "bg-muted text-foreground" : ROW_IDLE,
        )}
      >
        <AnimatedIcon icon={Icon} size={16} className="shrink-0" />
        {!collapsed && <span className="min-w-0 flex-1 truncate">{label}</span>}
        {!collapsed && count !== undefined && <span className="text-2xs tabular-nums text-muted-foreground">{count}</span>}
        {!collapsed && active && count === undefined && <ChevronRight className="size-3.5 shrink-0" aria-hidden="true" />}
      </Link>
    );
    return collapsed ? <Hint label={label} side="right">{link}</Hint> : link;
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      <div className={cn(
        "flex h-16 shrink-0 items-center pt-2",
        collapsed ? "flex-col justify-center px-2" : "gap-2.5 px-4",
      )}>
        <Link href="/home" aria-label="Ciele home" className="press-control flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">C</Link>
        {!collapsed && <>
          <span className="min-w-0 flex-1 truncate text-sm font-semibold">{title}</span>
          <Hint label={`Find ${title.toLowerCase()}`} side="bottom">
            <button type="button" aria-label={`Find ${title.toLowerCase()}`} onClick={() => searchRef.current?.focus()} className="press-control text-muted-foreground hover:bg-muted hover:text-foreground flex size-7 shrink-0 items-center justify-center rounded-lg transition-colors">
              <AnimatedIcon icon={Search} size={16} />
            </button>
          </Hint>
          <Hint label={toggleLabel} side="right">
            <button
              type="button"
              aria-label={toggleLabel}
              aria-expanded={!collapsed}
              onClick={onToggle}
              onPointerEnter={(event) => { if (event.pointerType === "mouse") setToggleHovered(true); }}
              onPointerLeave={() => setToggleHovered(false)}
              className="press-control text-muted-foreground hover:bg-muted hover:text-foreground flex size-7 shrink-0 items-center justify-center rounded-lg transition-colors"
            >
              <SidebarToggleIcon isOpen={toggleHovered ? collapsed : !collapsed} className="size-4" />
            </button>
          </Hint>
        </>}
      </div>
      {!collapsed && <div className="px-4 pt-3 pb-1">
        <div className="relative">
          <Search aria-hidden="true" className="pointer-events-none absolute top-2.5 left-3 size-3.5 text-muted-foreground" />
          <Input ref={searchRef} type="search" aria-label={`Search ${title.toLowerCase()}`} placeholder={`Search ${title.toLowerCase()}…`} value={query} onChange={(event) => setQuery(event.target.value)} className="h-9 rounded-md bg-background pl-9 text-xs" />
        </div>
      </div>}
      <nav aria-label={`${title} navigation`} className={cn("no-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain pb-3", collapsed ? "px-2 pt-3" : "px-3 pt-3")}>
        <HoverHighlight className="flex flex-col">
          {row(overviewPath, `All ${title.toLowerCase()}`, LayoutDashboard, pathname === overviewPath, entries.length)}
          {CATALOG_GROUPS.map((group) => {
            const families = (collapsed ? entries : visible).filter((family) => family.group === group);
            if (!families.length) return null;
            const Icon = groupIcons[group] ?? Boxes;
            return <NavSection key={group} label={group} collapsed={collapsed}>
              {collapsed
                ? row(catalogPath(current?.group === group ? current : families[0]), group, Icon, current?.group === group)
                : families.map((family) => <div key={family.slug} className="w-full">{row(catalogPath(family), family.title, Icon, pathname === catalogPath(family))}</div>)}
            </NavSection>;
          })}
          {!collapsed && !visible.length && <p role="status" className="px-3 py-4 text-sm text-muted-foreground">No {title.toLowerCase()} match “{query}”.</p>}
        </HoverHighlight>
      </nav>
      {!collapsed && <div className="space-y-2 border-t px-4 py-4">
        <p className="text-2xs text-muted-foreground">Preview palette</p>
        <div className="flex gap-2">
          {(["midnight", "mist-blue"] as const).map((palette) => <Button key={palette} variant="outline" size="xs" aria-pressed={colorPalette === palette} onClick={() => setColorPalette(palette)}>{colorPalette === palette && <Check className="size-3" />}{palette === "midnight" ? "Midnight" : "Mist Blue"}</Button>)}
        </div>
      </div>}
    </div>
  );
}
