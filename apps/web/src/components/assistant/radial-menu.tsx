"use client";

// Adapted from Bencho Radial menu (MIT), copyright (c) 2026 Lorenzo Cabra.
// See radial-menu.LICENSE. The fan faces into the workspace from its left edge.

import { Button as CieleButton } from "@agent-hub/ui";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Ellipsis, X, type LucideIcon } from "lucide-react";

type RadialAction = { label: string; icon: LucideIcon; run: () => void };
export function RadialMenu({
  actions,
  onOpen,
}: {
  actions: readonly RadialAction[];
  onOpen: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [aim, setAim] = useState<number | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const core = useRef<HTMLButtonElement>(null);
  const gesture = useRef<{ x: number; y: number; wasOpen: boolean } | null>(
    null,
  );
  const angle = (index: number) =>
    -45 + (45 * index) / Math.max(1, actions.length - 1);
  const nearest = (x: number, y: number) => {
    const pointerAngle = (Math.atan2(y, x) * 180) / Math.PI;
    let best = 0,
      distance = Infinity;
    actions.forEach((_, index) => {
      const delta = Math.abs(((pointerAngle - angle(index) + 540) % 360) - 180);
      if (delta < distance) {
        best = index;
        distance = delta;
      }
    });
    return best;
  };
  const close = () => {
    setOpen(false);
    setAim(null);
    core.current?.focus();
  };
  const choose = (index: number) => {
    close();
    actions[index]?.run();
  };
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !root.current?.contains(event.target)
      ) {
        setOpen(false);
        setAim(null);
      }
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      setAim(null);
      core.current?.focus();
    };
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", escape, true);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("keydown", escape, true);
    };
  }, [open]);
  return (
    <div
      ref={root}
      className="canvas-radial"
      data-open={open}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.preventDefault();
          event.stopPropagation();
          close();
        }
        if (
          [
            "ArrowDown",
            "ArrowUp",
            "ArrowRight",
            "ArrowLeft",
            "Home",
            "End",
          ].includes(event.key)
        ) {
          event.preventDefault();
          if (!open) {
            onOpen();
            setOpen(true);
          }
          const buttons =
            root.current?.querySelectorAll<HTMLButtonElement>(
              '[role="menuitem"]',
            );
          if (!buttons?.length) return;
          const current = Array.from(buttons).findIndex(
            (button) => button === document.activeElement,
          );
          const index =
            event.key === "Home"
              ? 0
              : event.key === "End"
                ? buttons.length - 1
                : (current +
                    (event.key === "ArrowUp" || event.key === "ArrowLeft"
                      ? -1
                      : 1) +
                    buttons.length) %
                  buttons.length;
          if (!open) requestAnimationFrame(() => buttons[index]?.focus());
          else buttons[index]?.focus();
        }
      }}
    >
      <div
        className="fan-arc"
        role="menu"
        aria-label="Layout actions"
        inert={!open}
        aria-hidden={!open}
      >
        {actions.map(({ label, icon: Icon }, index) => {
          const radians = (angle(index) * Math.PI) / 180;
          const style: CSSProperties = {
            transform: open
              ? `translate(${Math.cos(radians) * 80}px, ${Math.sin(radians) * 80}px) scale(1)`
              : "translate(0,0) scale(.35)",
            transitionDelay: open ? `${index * 28}ms` : "0ms",
          };
          return (
            <button
              key={label}
              type="button"
              role="menuitem"
              tabIndex={open ? 0 : -1}
              aria-label={label}
              className="fan-opt gpane"
              data-live={aim === index}
              style={style}
              onClick={() => choose(index)}
            >
              <Icon size={21} aria-hidden />
              <span className="fan-label">{label}</span>
            </button>
          );
        })}
      </div>
      <CieleButton variant="ghost" size="icon-sm"
        ref={core}
        type="button"
        className="bar-tool fan-core"
        aria-label="More canvas controls"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(event) => {
          if (event.detail === 0) {
            if (!open) {
              onOpen();
              setOpen(true);
              requestAnimationFrame(() =>
                root.current
                  ?.querySelector<HTMLButtonElement>('[role="menuitem"]')
                  ?.focus(),
              );
            } else close();
          }
        }}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.stopPropagation();
          gesture.current = {
            x: event.clientX,
            y: event.clientY,
            wasOpen: open,
          };
          onOpen();
          setOpen(true);
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const start = gesture.current;
          if (!start) return;
          const x = event.clientX - start.x,
            y = event.clientY - start.y;
          setAim(Math.hypot(x, y) >= 14 ? nearest(x, y) : null);
        }}
        onPointerUp={(event) => {
          const start = gesture.current;
          gesture.current = null;
          if (!start) return;
          const x = event.clientX - start.x,
            y = event.clientY - start.y;
          if (Math.hypot(x, y) >= 14) choose(nearest(x, y));
          else if (start.wasOpen) close();
          setAim(null);
        }}
        onPointerCancel={() => {
          gesture.current = null;
          close();
        }}
        onLostPointerCapture={() => {
          gesture.current = null;
          setAim(null);
        }}
      >
        {open ? (
          <X size={17} aria-hidden />
        ) : (
          <Ellipsis size={17} aria-hidden />
        )}
      </CieleButton>
    </div>
  );
}
