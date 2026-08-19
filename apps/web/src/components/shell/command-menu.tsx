"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import { CornerDownLeft, MessagesSquare, Search } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@agent-hub/ui";
import { AnimatedIcon } from "@/components/ui/animated-icon";
import { fuzzyMatch } from "@/lib/fuzzy";
import {
  GLOBAL_NAV,
  SETUP_SECTIONS,
  assistantIdFromPath,
  setupHref,
  type AssistantSummary,
} from "@/components/shell/nav";
import type { LucideIcon } from "lucide-react";

interface FindItem {
  key: string;
  label: string;
  group: string;
  keywords: string[];
  icon: LucideIcon;
  href: string;
}

/**
 * "Find..." palette: fuzzy search over assistants, admin pages and the scoped
 * SETUP sections, grouped by kind. Opened from the sidebar or with F / Cmd+K
 * (see ShellProvider). The active row is a single highlight element that
 * slides between rows as the selection moves.
 */
export function CommandMenu({
  open,
  onOpenChange,
  assistants,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  assistants: AssistantSummary[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const uid = useId();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const scopedId = assistantIdFromPath(pathname);
  const scopedTitle = scopedId
    ? assistants.find((a) => a.id === scopedId)?.title
    : undefined;

  const items = useMemo<FindItem[]>(() => {
    const q = query.trim();
    const matches = (item: Omit<FindItem, "key" | "icon" | "href">) =>
      [item.label, item.group, ...item.keywords].some((hay) =>
        fuzzyMatch(q, hay),
      );

    const all: FindItem[] = [
      ...assistants.map((a) => ({
        key: `assistant:${a.id}`,
        label: a.title,
        group: "Assistants",
        keywords: [a.nickname, a.id],
        icon: MessagesSquare,
        href: `/assistants/${a.id}`,
      })),
      ...GLOBAL_NAV.map((item) => ({
        key: `page:${item.href}`,
        label: item.label,
        group: "Pages",
        keywords: [],
        icon: item.icon,
        href: item.href,
      })),
      ...SETUP_SECTIONS.filter((section) => section.enabled).map((section) => ({
        key: `setup:${section.slug}`,
        label: section.label,
        group: scopedTitle ? `Setup · ${scopedTitle}` : "Setup",
        keywords: [],
        icon: section.icon,
        href: setupHref(scopedId, section.slug),
      })),
    ];

    return all.filter(matches);
  }, [assistants, query, scopedId, scopedTitle]);

  const grouped = useMemo(() => {
    const map = new Map<string, FindItem[]>();
    for (const item of items) {
      const list = map.get(item.group) ?? [];
      list.push(item);
      map.set(item.group, list);
    }
    return Array.from(map.entries());
  }, [items]);

  // Reset the search on close and the selection on every keystroke, done in
  // the handlers (not effects) to avoid cascading renders.
  function handleOpenChange(next: boolean) {
    if (!next) {
      setQuery("");
      setActive(0);
    }
    onOpenChange(next);
  }

  function handleQueryChange(next: string) {
    setQuery(next);
    setActive(0);
  }

  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active]);

  // One highlight element slides between rows (translateY + height transition)
  // instead of each row toggling its own background, the beui "layout"
  // effect, done in CSS. The callback ref covers first mount (the dialog
  // portal mounts after this component renders, so an effect on `open` runs
  // too early and finds nothing); the layout effect covers re-filters that
  // move the already-active row.
  const [highlight, setHighlight] = useState<{
    top: number;
    height: number;
  } | null>(null);
  const measureActiveRow = useCallback((el: HTMLElement | null) => {
    if (el) setHighlight({ top: el.offsetTop, height: el.offsetHeight });
  }, []);
  useLayoutEffect(() => {
    measureActiveRow(
      listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`) ??
        null,
    );
  }, [active, items, measureActiveRow]);

  function select(item: FindItem) {
    handleOpenChange(false);
    router.push(item.href);
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((i) => Math.min(i + 1, items.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const item = items[active];
      if (item) select(item);
    }
  }

  let cursor = 0;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        showCloseButton={false}
        overlayClassName="bg-background/5 supports-backdrop-filter:backdrop-blur-md supports-backdrop-filter:backdrop-saturate-150 data-open:duration-200 data-closed:duration-100"
        className="top-[18vh] translate-y-0 gap-0 overflow-hidden rounded-2xl p-0 shadow-2xl will-change-transform sm:max-w-xl data-open:duration-300 data-open:ease-[cubic-bezier(0.16,1,0.3,1)] data-open:slide-in-from-top-2 data-closed:duration-100 data-closed:slide-out-to-top-2"
      >
        <DialogTitle className="sr-only">Find</DialogTitle>
        <div className="flex items-center gap-2.5 border-b px-4">
          <Search className="text-muted-foreground size-4 shrink-0" />
          <input
            autoFocus
            value={query}
            onChange={(e) => handleQueryChange(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Find..."
            role="combobox"
            aria-expanded={open}
            aria-controls={`${uid}-list`}
            aria-activedescendant={
              items.length > 0 ? `${uid}-opt-${active}` : undefined
            }
            aria-autocomplete="list"
            className="placeholder:text-muted-foreground h-12 w-full bg-transparent text-sm outline-none"
          />
          <kbd className="text-muted-foreground rounded-md border px-1.5 py-0.5 font-sans text-xs">
            Esc
          </kbd>
        </div>
        <div
          ref={listRef}
          id={`${uid}-list`}
          role="listbox"
          aria-label="Find results"
          className="relative max-h-80 overflow-y-auto p-2"
        >
          {highlight && items.length > 0 && (
            <div
              aria-hidden
              className="bg-muted pointer-events-none absolute inset-x-2 top-0 rounded-lg transition-[transform,height] duration-150 ease-out motion-reduce:transition-none"
              style={{
                height: highlight.height,
                transform: `translateY(${highlight.top}px)`,
              }}
            />
          )}
          {items.length === 0 && (
            <p className="text-muted-foreground px-3 py-8 text-center text-sm">
              No results for “{query}”.
            </p>
          )}
          {grouped.map(([group, list]) => (
            <div key={group} className="mb-1 last:mb-0">
              <div
                aria-hidden
                className="text-muted-foreground px-2 py-1.5 text-[10px] font-semibold tracking-wider uppercase"
              >
                {group}
              </div>
              {list.map((item) => {
                const index = cursor++;
                const isActive = index === active;
                const Icon = item.icon;
                return (
                  <button
                    key={item.key}
                    ref={isActive ? measureActiveRow : undefined}
                    type="button"
                    id={`${uid}-opt-${index}`}
                    role="option"
                    aria-selected={isActive}
                    data-index={index}
                    onMouseEnter={() => setActive(index)}
                    onClick={() => select(item)}
                    className={`relative flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                      isActive ? "text-foreground" : "text-muted-foreground"
                    }`}
                  >
                    <AnimatedIcon icon={Icon} size={16} className="shrink-0" />
                    <span className="min-w-0 flex-1 truncate font-medium">
                      {item.label}
                    </span>
                    {isActive && (
                      <AnimatedIcon
                        icon={CornerDownLeft}
                        size={14}
                        iconClassName="text-muted-foreground"
                        className="shrink-0"
                      />
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
