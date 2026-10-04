"use client";
// beui.dev/components/agents/ai-sidebar, trimmed to conversation navigation.

import { FileText, Folder, FolderOpen, MoreHorizontal } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  MorphPopover,
  MorphPopoverContent,
  MorphPopoverTrigger,
} from "@/components/motion/popover-morph";
import { EASE_OUT, SPRING_LAYOUT } from "@/lib/ease";
import { cn } from "@/lib/utils";

export interface SidebarResource {
  id: string;
  label: string;
  kind: "folder" | "file";
  children?: SidebarResource[];
  disabled?: boolean;
}

interface AISidebarProps {
  items: SidebarResource[];
  activeId: string | null;
  onActiveChange: (id: string) => void;
  defaultExpandedIds?: string[];
  renderIcon?: (item: SidebarResource) => ReactNode;
  wrapRow?: (item: SidebarResource, row: ReactNode) => ReactNode;
  renderMenu?: (item: SidebarResource, controls: { close: () => void }) => ReactNode;
  ariaLabel?: string;
  className?: string;
}

interface FlatResource {
  item: SidebarResource;
  depth: number;
  parentId: string | null;
}

const ROW_REVEAL = { duration: 0.16, ease: EASE_OUT } as const;

function flattenResources(
  items: SidebarResource[],
  expanded: Set<string>,
  depth = 0,
  parentId: string | null = null,
): FlatResource[] {
  return items.flatMap((item) => {
    const row = { item, depth, parentId };
    if (!item.children?.length || !expanded.has(item.id)) return [row];
    return [row, ...flattenResources(item.children, expanded, depth + 1, item.id)];
  });
}

function defaultIcon(item: SidebarResource, expanded: boolean) {
  const Icon = item.kind === "folder" ? (expanded ? FolderOpen : Folder) : FileText;
  return <Icon className="size-4" />;
}

function MarqueeLabel({ active, children }: { active: boolean; children: string }) {
  const reduce = useReducedMotion() ?? false;
  const viewportRef = useRef<HTMLSpanElement>(null);
  const labelRef = useRef<HTMLSpanElement>(null);
  const [distance, setDistance] = useState(0);

  useEffect(() => {
    const measure = () => {
      const viewport = viewportRef.current;
      const label = labelRef.current;
      if (!viewport || !label) return;
      setDistance(label.scrollWidth > viewport.clientWidth ? label.scrollWidth + 24 : 0);
    };
    measure();
    const observer = new ResizeObserver(measure);
    if (viewportRef.current) observer.observe(viewportRef.current);
    if (labelRef.current) observer.observe(labelRef.current);
    return () => observer.disconnect();
  }, []);

  const running = active && distance > 0 && !reduce;

  return (
    <span ref={viewportRef} className="block min-w-0 flex-1 overflow-hidden">
      <motion.span
        className="flex w-max items-center gap-6 whitespace-nowrap"
        animate={{ x: running ? [0, -distance] : 0 }}
        transition={
          running
            ? {
                duration: Math.max(2.4, distance / 34),
                ease: "linear",
                repeat: Number.POSITIVE_INFINITY,
                repeatDelay: 2,
              }
            : ROW_REVEAL
        }
      >
        <span ref={labelRef}>{children}</span>
        {running ? <span aria-hidden="true">{children}</span> : null}
      </motion.span>
    </span>
  );
}

interface ResourceRowProps {
  row: FlatResource;
  active: boolean;
  expanded: boolean;
  focused: boolean;
  menuOpen: boolean;
  onFocus: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
  onMenuOpenChange: (open: boolean) => void;
  onSelect: () => void;
  onToggle: () => void;
  renderIcon?: AISidebarProps["renderIcon"];
  wrapRow?: AISidebarProps["wrapRow"];
  renderMenu?: AISidebarProps["renderMenu"];
  setRef: (node: HTMLDivElement | null) => void;
}

function ResourceRow({
  row,
  active,
  expanded,
  focused,
  menuOpen,
  onFocus,
  onKeyDown,
  onMenuOpenChange,
  onSelect,
  onToggle,
  renderIcon,
  renderMenu,
  wrapRow,
  setRef,
}: ResourceRowProps) {
  const reduce = useReducedMotion() ?? false;
  const [hovered, setHovered] = useState(false);
  const folder = row.item.kind === "folder";
  const menu = renderMenu?.(row.item, { close: () => onMenuOpenChange(false) });

  const content = (
    <motion.div
      ref={setRef}
      layout="position"
      transition={reduce ? { duration: 0 } : SPRING_LAYOUT}
      role="treeitem"
      aria-level={row.depth + 1}
      aria-selected={folder ? undefined : active}
      aria-expanded={folder ? expanded : undefined}
      aria-disabled={row.item.disabled || undefined}
      tabIndex={focused ? 0 : -1}
      data-menu-open={menuOpen || undefined}
      onFocus={onFocus}
      onKeyDown={onKeyDown}
      onClick={(event) => {
        if (event.defaultPrevented || row.item.disabled) return;
        if (folder) onToggle();
        else onSelect();
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={cn(
        "group/resource relative flex min-h-9 min-w-0 cursor-pointer items-center gap-2.5 rounded-xl pr-3 text-sm outline-none",
        "text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
        "focus-visible:bg-muted/70 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
        "data-[menu-open=true]:bg-muted data-[menu-open=true]:text-foreground",
        !folder && active && "bg-muted text-foreground",
        row.item.disabled && "cursor-not-allowed opacity-45",
      )}
      style={{ paddingLeft: `${12 + row.depth * 16}px` }}
    >
      <span aria-hidden="true" className="grid size-5 shrink-0 place-items-center">
        {renderIcon?.(row.item) ?? defaultIcon(row.item, expanded)}
      </span>
      <MarqueeLabel active={hovered || menuOpen}>{row.item.label}</MarqueeLabel>
      {!row.item.disabled && menu ? (
        <MorphPopover open={menuOpen} onOpenChange={onMenuOpenChange}>
          <MorphPopoverTrigger>
            <button
              data-resource-actions
              type="button"
              tabIndex={-1}
              aria-label={`Actions for ${row.item.label}`}
              onClick={(event) => event.stopPropagation()}
              className="grid size-7 shrink-0 place-items-center rounded-lg opacity-0 outline-none transition-opacity hover:bg-foreground/5 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring group-hover/resource:opacity-100 group-data-[menu-open=true]/resource:opacity-100"
            >
              <MoreHorizontal aria-hidden="true" className="size-4" />
            </button>
          </MorphPopoverTrigger>
          <MorphPopoverContent side="bottom" align="end" className="w-40 p-1.5">
            <div data-sidebar-resource-menu={row.item.id}>{menu}</div>
          </MorphPopoverContent>
        </MorphPopover>
      ) : null}
    </motion.div>
  );
  return wrapRow ? wrapRow(row.item, content) : content;
}

export function AISidebar({
  items,
  activeId,
  onActiveChange,
  defaultExpandedIds = [],
  renderIcon,
  renderMenu,
  wrapRow,
  ariaLabel = "Resources",
  className,
}: AISidebarProps) {
  const [expandedIds, setExpandedIds] = useState(() => new Set(defaultExpandedIds));
  const [focusedId, setFocusedId] = useState<string | null>(activeId);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  const flat = useMemo(() => flattenResources(items, expandedIds), [expandedIds, items]);

  const fallbackFocusId = flat[0]?.item.id ?? null;
  if (
    !(focusedId && flat.some((row) => row.item.id === focusedId)) &&
    focusedId !== fallbackFocusId
  ) {
    setFocusedId(fallbackFocusId);
  }

  useEffect(() => {
    if (!menuOpenId) return;
    const frame = requestAnimationFrame(() => {
      const menus = Array.from(document.querySelectorAll<HTMLElement>("[data-sidebar-resource-menu]"));
      menus
        .find((menu) => menu.dataset.sidebarResourceMenu === menuOpenId)
        ?.querySelector<HTMLElement>("button, a[href]")
        ?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [menuOpenId]);

  const focusRow = useCallback((id: string) => {
    setFocusedId(id);
    requestAnimationFrame(() => rowRefs.current.get(id)?.focus());
  }, []);

  const toggle = useCallback((id: string) => {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>, row: FlatResource) => {
      const index = flat.findIndex(({ item }) => item.id === row.item.id);
      const previous = flat[index - 1];
      const next = flat[index + 1];
      const moveModifier = event.altKey && event.shiftKey;

      if (event.key === "ArrowDown" && !moveModifier && next) {
        event.preventDefault();
        focusRow(next.item.id);
        return;
      }
      if (event.key === "ArrowUp" && !moveModifier && previous) {
        event.preventDefault();
        focusRow(previous.item.id);
        return;
      }
      if (event.key === "Home" && flat[0]) {
        event.preventDefault();
        focusRow(flat[0].item.id);
        return;
      }
      if (event.key === "End" && flat.at(-1)) {
        event.preventDefault();
        focusRow(flat.at(-1)?.item.id ?? row.item.id);
        return;
      }
      if (row.item.disabled) {
        if (event.key === "ArrowLeft" && row.parentId) {
          event.preventDefault();
          focusRow(row.parentId);
        } else if (
          moveModifier ||
          ["ArrowRight", "Enter", " ", "F2", "ContextMenu"].includes(event.key) ||
          (event.shiftKey && event.key === "F10")
        ) {
          event.preventDefault();
        }
        return;
      }
      if (moveModifier || event.key === "F2") {
        event.preventDefault();
        return;
      }
      if (event.key === "ArrowRight" && row.item.kind === "folder") {
        event.preventDefault();
        if (!expandedIds.has(row.item.id)) toggle(row.item.id);
        else if (next?.parentId === row.item.id) focusRow(next.item.id);
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        if (expandedIds.has(row.item.id)) toggle(row.item.id);
        else if (row.parentId) focusRow(row.parentId);
      } else if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        if (row.item.kind === "folder") toggle(row.item.id);
        else onActiveChange(row.item.id);
      } else if (
        renderMenu &&
        (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10"))
      ) {
        event.preventDefault();
        setMenuOpenId(row.item.id);
      }
    },
    [expandedIds, flat, focusRow, onActiveChange, renderMenu, toggle],
  );

  return (
    <div
      role="tree"
      aria-label={ariaLabel}
      aria-multiselectable="false"
      className={cn(
        "relative flex min-w-0 flex-col gap-0.5 [overflow-anchor:none] group-data-[state=collapsed]/sidebar:hidden",
        className,
      )}
    >
      <AnimatePresence initial={false}>
        {flat.map((row) => (
          <ResourceRow
            key={row.item.id}
            row={row}
            active={activeId === row.item.id}
            expanded={expandedIds.has(row.item.id)}
            focused={focusedId === row.item.id}
            menuOpen={menuOpenId === row.item.id}
            onFocus={() => setFocusedId(row.item.id)}
            onSelect={() => onActiveChange(row.item.id)}
            onToggle={() => toggle(row.item.id)}
            onKeyDown={(event) => handleKeyDown(event, row)}
            onMenuOpenChange={(open) => {
              setMenuOpenId(open ? row.item.id : null);
              if (!open) focusRow(row.item.id);
            }}
            renderIcon={renderIcon}
            renderMenu={renderMenu}
            wrapRow={wrapRow}
            setRef={(node) => {
              if (node) rowRefs.current.set(row.item.id, node);
              else rowRefs.current.delete(row.item.id);
            }}
          />
        ))}
      </AnimatePresence>
    </div>
  );
}
