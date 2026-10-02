"use client";

import {
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import { Grip } from "lucide-react";

type Axis = "width" | "height";

/** The preview's two resize edges, confined to the available admin panel. */
export function ImprovementGroupedPanel({
  children,
}: {
  children: (width: number) => ReactNode;
}) {
  const host = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const drag = useRef<{
    axis: Axis;
    pointer: number;
    start: number;
    size: number;
  } | null>(null);
  const [available, setAvailable] = useState({ width: 1024, height: 720 });
  const [chosen, setChosen] = useState<Partial<Record<Axis, number>>>({});
  const [measuredWidth, setMeasuredWidth] = useState(1024);
  const [resizing, setResizing] = useState(false);

  useLayoutEffect(() => {
    const outer = host.current;
    const inner = panel.current;
    if (!outer || !inner) return;
    const observer = new ResizeObserver(() => {
      const width = outer.clientWidth;
      const height = outer.clientHeight;
      setAvailable((current) =>
        current.width === width && current.height === height
          ? current
          : { width, height },
      );
      setMeasuredWidth(inner.clientWidth);
    });
    observer.observe(outer);
    observer.observe(inner);
    return () => observer.disconnect();
  }, []);

  const minimum = (axis: Axis) =>
    Math.min(axis === "width" ? 320 : 240, available[axis]);
  const size = (axis: Axis) =>
    Math.max(
      minimum(axis),
      Math.min(
        chosen[axis] ??
          (axis === "height"
            ? Math.min(720, available.height)
            : available.width),
        available[axis],
      ),
    );
  function resize(axis: Axis, value: number) {
    setChosen((current) => ({
      ...current,
      [axis]: Math.max(minimum(axis), Math.min(value, available[axis])),
    }));
  }
  function start(axis: Axis, event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      axis,
      pointer: event.pointerId,
      start: axis === "width" ? event.clientX : event.clientY,
      size: panel.current?.getBoundingClientRect()[axis] ?? size(axis),
    };
    setResizing(true);
  }
  function move(event: PointerEvent<HTMLDivElement>) {
    const active = drag.current;
    if (!active || active.pointer !== event.pointerId) return;
    resize(
      active.axis,
      active.size +
        (active.axis === "width" ? event.clientX : event.clientY) -
        active.start,
    );
  }
  function stop() {
    drag.current = null;
    setResizing(false);
  }
  function key(axis: Axis, event: KeyboardEvent<HTMLDivElement>) {
    const lower = axis === "width" ? "ArrowLeft" : "ArrowUp";
    const higher = axis === "width" ? "ArrowRight" : "ArrowDown";
    const step = event.shiftKey ? 40 : 10;
    if (![lower, higher, "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    resize(
      axis,
      event.key === "Home"
        ? minimum(axis)
        : event.key === "End"
          ? available[axis]
          : size(axis) + (event.key === lower ? -step : step),
    );
  }

  return (
    <div
      ref={host}
      className="h-full min-h-0 w-full"
      data-slot="improvement-grouped-host"
    >
      <div
        ref={panel}
        data-slot="improvement-grouped-table"
        data-resizing={resizing || undefined}
        className="squircle-card bg-card relative flex [container-type:inline-size] max-h-full max-w-full flex-col rounded-2xl border p-2 shadow-light data-[resizing]:select-none"
        style={{
          width: chosen.width === undefined ? "100%" : size("width"),
          height: size("height"),
        }}
      >
        <div
          className="min-h-0 flex-1 overflow-auto overscroll-contain pb-3"
          data-slot="improvement-grouped-scroll"
        >
          {children(measuredWidth)}
        </div>
        {(["width", "height"] as const).map((axis) => (
          <div
            key={axis}
            role="separator"
            tabIndex={0}
            aria-label={`Resize improvements ${axis}`}
            aria-orientation={axis === "width" ? "vertical" : "horizontal"}
            aria-valuemin={Math.round(minimum(axis))}
            aria-valuemax={Math.round(available[axis])}
            aria-valuenow={Math.round(size(axis))}
            onPointerDown={(event) => start(axis, event)}
            onPointerMove={move}
            onPointerUp={stop}
            onPointerCancel={stop}
            onLostPointerCapture={stop}
            onKeyDown={(event) => key(axis, event)}
            onDoubleClick={() =>
              setChosen((current) => ({ ...current, [axis]: undefined }))
            }
            className={`group absolute z-10 touch-none rounded-full outline-none focus-visible:bg-primary/15 ${axis === "width" ? "top-4 right-0 bottom-4 w-3 cursor-col-resize" : "right-4 bottom-0 left-4 h-3 cursor-row-resize"}`}
          >
            <span
              className={`bg-border group-hover:bg-primary/60 group-focus-visible:bg-primary absolute rounded-full transition-colors ${axis === "width" ? "top-1/2 right-0.5 h-8 w-0.5 -translate-y-1/2" : "bottom-0.5 left-1/2 h-0.5 w-8 -translate-x-1/2"}`}
            />
          </div>
        ))}
        <Grip
          className="text-muted-foreground/40 pointer-events-none absolute right-1 bottom-1 size-3"
          aria-hidden="true"
        />
      </div>
    </div>
  );
}
