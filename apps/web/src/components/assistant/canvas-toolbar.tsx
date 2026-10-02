"use client";

// Adapted from Bencho Canvas toolbar (MIT), copyright (c) 2026 Lorenzo Cabra.
// https://bencho.dev/licence — see canvas-toolbar.LICENSE.
import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import {
  Frame,
  Hand,
  Minus,
  MousePointer2,
  Plus,
  type LucideIcon,
} from "lucide-react";
import { Hint } from "@agent-hub/ui";
import { RadialMenu } from "@/components/assistant/radial-menu";

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/* ══ 1 · canvas toolbar ═══════════════════════════════════
   A floating tool bar, the kind every canvas app grows. No
   title, no chip — it is a bar, and a bar is the whole
   component.

   Ciele's slots operate on Flow steps rather than drawing
   shapes. Select and Pan keep the active tool; Add opens the
   existing step catalogue. View commands stay in the bar. */

/* ── the toolbar's two corners, and they are concentric ────
   The rail is 14 and the tools inside it are 10, which is the
   rail's radius less the 4px of padding between them — the
   rule that makes a corner hug what is inside it. So the knob
   sets the RAIL and the tools follow, and there is no setting
   where a square rail holds rounded tools. */
const BAR_CORNER = 15;
const BAR_MAX = 25;

export function CanvasToolbar({
  tool,
  onToolChange,
  pickerOpen,
  onPickerOpenChange,
  picker,
  readOnly,
  onFit,
  onZoomIn,
  onZoomOut,
  controls,
  corner = BAR_CORNER,
}: {
  tool: "select" | "hand";
  onToolChange: (tool: "select" | "hand") => void;
  pickerOpen: boolean;
  onPickerOpenChange: (open: boolean) => void;
  picker: ReactNode;
  readOnly: boolean;
  onFit: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  controls: Array<{ label: string; icon: LucideIcon; run: () => void }>;
  corner?: number;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  const open = pickerOpen && !readOnly;
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !rootRef.current?.contains(event.target)
      )
        onPickerOpenChange(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      onPickerOpenChange(false);
      addRef.current?.focus();
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open, onPickerOpenChange]);
  const style: CSSProperties & { "--bar-r": string; "--bar-tool-r": string } = {
    "--bar-r": `${clamp(corner, 0, BAR_MAX)}px`,
    "--bar-tool-r": `${Math.max(0, clamp(corner, 0, BAR_MAX) - 4)}px`,
  };
  return (
    <div
      ref={rootRef}
      className="canvas-toolbar bar-well pointer-events-auto"
      style={style}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {open && <div className="bar-flyout gpane">{picker}</div>}
      <div
        className="bar-rail gpane"
        role="toolbar"
        aria-label="Canvas tools"
        aria-orientation="vertical"
      >
        {(
          [
            { key: "select", label: "Select", Icon: MousePointer2 },
            { key: "hand", label: "Pan", Icon: Hand },
          ] as const
        ).map(({ key, label, Icon }) => (
          <Hint key={key} label={label} side="right">
            <button
              type="button"
              className="bar-tool"
              data-on={tool === key}
              aria-pressed={tool === key}
              aria-label={label}
              onClick={() => {
                onPickerOpenChange(false);
                onToolChange(key);
              }}
            >
              <Icon size={17} strokeWidth={2} aria-hidden />
            </button>
          </Hint>
        ))}
        {!readOnly && (
          <Hint label="Add a step" side="right">
            <button
              ref={addRef}
              type="button"
              className="bar-tool"
              data-on={open}
              aria-label="Add a step"
              aria-expanded={open}
              onClick={() => onPickerOpenChange(!open)}
            >
              <Plus size={17} strokeWidth={2} aria-hidden />
            </button>
          </Hint>
        )}
        <span className="bar-split" aria-hidden />
        <Hint label="Fit to view" side="right">
          <button
            type="button"
            className="bar-tool"
            aria-label="Fit to view"
            onClick={onFit}
          >
            <Frame size={17} strokeWidth={2} aria-hidden />
          </button>
        </Hint>
        {[
          { label: "Zoom in", Icon: Plus, run: onZoomIn },
          { label: "Zoom out", Icon: Minus, run: onZoomOut },
        ].map(({ label, Icon, run }) => (
          <Hint key={label} label={label} side="right">
            <button
              type="button"
              className="bar-tool"
              aria-label={label}
              onClick={run}
            >
              <Icon size={17} aria-hidden />
            </button>
          </Hint>
        ))}
        <RadialMenu
          actions={controls}
          onOpen={() => onPickerOpenChange(false)}
        />

      </div>
    </div>
  );
}
