"use client";

import React from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { ChevronDown } from "lucide-react";
import { cn } from "@agent-hub/ui";
import { menuItems } from "@/components/home/nav-menu";
import { loadAnimatedIcons } from "@/components/home/animated-icons";

/**
 * Ciele adaptation of Unlumen's Motion Navigation Menu:
 * https://ui.unlumen.com/components/motion-navigation-menu
 *
 * Keeps its shared spring viewport, directional transitions and moving
 * highlight. Motion stays in the lazy viewport so the four triggers remain
 * server-rendered without adding the animation library to the initial bundle.
 */
const MotionNavigationMenuViewport = dynamic(
  () => import("./nav-dropdown").then((module) => module.MotionNavigationMenuViewport),
  { ssr: false }
);

const CLOSE_GRACE_MS = 220;
const PANEL_MARGIN = 16;

export type TriggerBounds = { x: number; y: number; width: number; height: number };

export function MotionNavigationMenu({ scrolled }: { scrolled: boolean }) {
  const id = React.useId();
  const rootRef = React.useRef<HTMLDivElement>(null);
  const triggerRefs = React.useRef(new Map<string, HTMLButtonElement>());
  const panelRef = React.useRef<HTMLDivElement>(null);
  const closeTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const panelWidth = React.useRef(0);
  const focusPanelWhenReady = React.useRef(false);
  const [reached, setReached] = React.useState(false);
  const [selection, setSelection] = React.useState({ value: "", lastValue: "", direction: 1 });
  const [position, setPosition] = React.useState<{ x: number; trigger: TriggerBounds } | null>(null);

  const cancelClose = React.useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = null;
  }, []);

  const closeMenu = React.useCallback(() => {
    cancelClose();
    focusPanelWhenReady.current = false;
    setSelection((current) => current.value ? { ...current, value: "" } : current);
  }, [cancelClose]);

  const updateViewportPosition = React.useCallback((value: string) => {
    const root = rootRef.current;
    const trigger = triggerRefs.current.get(value);
    if (!root || !trigger) return;
    const rootBox = root.getBoundingClientRect();
    const box = trigger.getBoundingClientRect();
    const center = box.left + box.width / 2;
    const half = panelWidth.current / 2;
    const x = Math.min(Math.max(center, PANEL_MARGIN + half), window.innerWidth - PANEL_MARGIN - half) - rootBox.left;
    const bounds = { x: box.left - rootBox.left, y: box.top - rootBox.top, width: box.width, height: box.height };
    setPosition((current) =>
      current?.x === x && current.trigger.x === bounds.x && current.trigger.y === bounds.y &&
      current.trigger.width === bounds.width && current.trigger.height === bounds.height
        ? current : { x, trigger: bounds }
    );
  }, []);

  const openValue = React.useCallback((value: string) => {
    cancelClose();
    setReached(true);
    setSelection((current) => {
      if (current.value === value) return current;
      const previous = menuItems.findIndex((item) => item.name === current.value);
      const next = menuItems.findIndex((item) => item.name === value);
      return { value, lastValue: value, direction: previous === -1 ? 1 : next > previous ? 1 : -1 };
    });
    updateViewportPosition(value);
  }, [cancelClose, updateViewportPosition]);

  const scheduleClose = () => {
    cancelClose();
    closeTimer.current = setTimeout(closeMenu, CLOSE_GRACE_MS);
  };

  React.useEffect(() => cancelClose, [cancelClose]);

  // The surrounding header morphs for 500ms on scroll. Track the moving
  // trigger for that interval, and re-clamp after a resize or content measure.
  React.useEffect(() => {
    if (!selection.value) return;
    let frame = 0;
    const deadline = performance.now() + 600;
    const track = () => {
      updateViewportPosition(selection.value);
      if (performance.now() < deadline) frame = requestAnimationFrame(track);
    };
    frame = requestAnimationFrame(track);
    const resize = () => updateViewportPosition(selection.value);
    window.addEventListener("resize", resize);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
    };
  }, [selection.value, scrolled, updateViewportPosition]);

  React.useEffect(() => {
    if (!selection.value) return;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) closeMenu();
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [selection.value, closeMenu]);

  function onKeyDown(event: React.KeyboardEvent) {
    const trigger = event.target instanceof HTMLButtonElement ? event.target : null;
    const buttons = [...triggerRefs.current.values()];
    const index = trigger ? buttons.indexOf(trigger) : -1;
    if (event.key === "Escape") {
      event.preventDefault();
      // Restore focus before closing: the trigger's focus handler may open it.
      triggerRefs.current.get(selection.value)?.focus();
      closeMenu();
    } else if (index !== -1 && (event.key === "ArrowRight" || event.key === "ArrowLeft")) {
      event.preventDefault();
      const step = event.key === "ArrowRight" ? 1 : -1;
      buttons[(index + step + buttons.length) % buttons.length]?.focus();
    } else if (index !== -1 && (event.key === "Home" || event.key === "End")) {
      event.preventDefault();
      buttons[event.key === "Home" ? 0 : buttons.length - 1]?.focus();
    } else if (index !== -1 && event.key === "ArrowDown") {
      event.preventDefault();
      focusPanelWhenReady.current = true;
      if (trigger?.dataset.value) openValue(trigger.dataset.value);
      requestAnimationFrame(() => {
        const link = panelRef.current?.querySelector<HTMLAnchorElement>("a");
        if (link) { link.focus(); focusPanelWhenReady.current = false; }
      });
    }
  }

  return (
    <div
      ref={rootRef}
      data-slot="navigation-menu"
      className="relative isolate hidden size-fit lg:block"
      onPointerEnter={() => { cancelClose(); setReached(true); loadAnimatedIcons(); }}
      onPointerLeave={scheduleClose}
      onKeyDown={onKeyDown}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) closeMenu();
      }}
    >
      <ul data-slot="navigation-menu-list" className="relative z-10 flex items-center gap-2 text-sm">
        {menuItems.map((item) => (
          <li key={item.name} data-slot="navigation-menu-item" data-value={item.name}>
            {item.columns ? (
              <button
                type="button"
                id={`${id}-${item.name}`}
                ref={(node) => {
                  if (node) triggerRefs.current.set(item.name, node);
                  else triggerRefs.current.delete(item.name);
                }}
                data-slot="navigation-menu-trigger"
                data-value={item.name}
                data-state={selection.value === item.name ? "open" : "closed"}
                data-foley-click="tick"
                aria-expanded={selection.value === item.name}
                aria-controls={selection.value === item.name ? `${id}-panel` : undefined}
                onPointerEnter={(event) => { if (event.pointerType !== "touch") openValue(item.name); }}
                onFocus={(event) => { if (event.currentTarget.matches(":focus-visible")) openValue(item.name); }}
                onClick={() => selection.value === item.name ? closeMenu() : openValue(item.name)}
                className="press-text group/trigger text-muted-foreground hover:text-foreground aria-expanded:text-foreground focus-visible:ring-ring/50 flex h-9 cursor-pointer items-center gap-1.5 rounded-xl px-3 outline-none transition-colors focus-visible:ring-2"
              >
                <span>{item.name}</span>
                <ChevronDown aria-hidden className={cn("size-3.5 transition-transform duration-200 motion-reduce:transition-none", selection.value === item.name && "rotate-180")} />
              </button>
            ) : (
              <Link href={item.href} target={item.external ? "_blank" : undefined} rel={item.external ? "noopener noreferrer" : undefined} onPointerEnter={closeMenu} className="press-text text-muted-foreground hover:text-foreground block px-3 py-2">
                {item.name}
              </Link>
            )}
          </li>
        ))}
      </ul>
      {reached && (
        <MotionNavigationMenuViewport
          item={menuItems.find((item) => item.name === selection.lastValue)}
          x={position?.x ?? 0}
          trigger={selection.value ? position?.trigger : undefined}
          direction={selection.direction}
          open={!!selection.value}
          panelId={`${id}-panel`}
          labelledBy={`${id}-${selection.lastValue}`}
          onNavigate={closeMenu}
          cardRef={panelRef}
          onMeasure={(width) => {
            panelWidth.current = width;
            updateViewportPosition(selection.value || selection.lastValue);
            if (focusPanelWhenReady.current) {
              requestAnimationFrame(() => {
                panelRef.current?.querySelector<HTMLAnchorElement>("a")?.focus();
                focusPanelWhenReady.current = false;
              });
            }
          }}
        />
      )}
    </div>
  );
}
