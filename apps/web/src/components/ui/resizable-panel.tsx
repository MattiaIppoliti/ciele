"use client";

import { GripVertical } from "lucide-react";
import { AnimatedIcon } from "@/components/ui/animated-icon";

// The resize behavior is shared byte-for-byte across apps; only the visual
// handle below is web-specific (animated grip + shadcn tokens).
export { useResizableWidth } from "@agent-hub/ui/use-resizable-width";

/** Neutral guide line + centered grip pill, shown on hover/drag. Matches the chat preview panel's handle. */
export function ResizeHandle({
  resizing,
  onPointerDown,
  side = "left",
  label = "Resize panel",
  value,
  minValue,
  maxValue,
  onValueChange,
}: {
  resizing: boolean;
  onPointerDown: (e: React.PointerEvent) => void;
  side?: "left" | "right";
  label?: string;
  value?: number;
  minValue?: number;
  maxValue?: number;
  onValueChange?: (value: number) => void;
}) {
  const adjustable =
    value !== undefined &&
    minValue !== undefined &&
    maxValue !== undefined &&
    onValueChange !== undefined;

  return (
    <div
      role={adjustable ? "separator" : "presentation"}
      aria-orientation={adjustable ? "vertical" : undefined}
      aria-label={adjustable ? label : undefined}
      aria-valuemin={adjustable ? minValue : undefined}
      aria-valuemax={adjustable ? maxValue : undefined}
      aria-valuenow={adjustable ? value : undefined}
      aria-description={
        adjustable
          ? "Use the arrow keys to resize, Shift plus an arrow for larger steps, Home for minimum, and End for maximum."
          : undefined
      }
      aria-hidden={adjustable ? undefined : true}
      tabIndex={adjustable ? 0 : undefined}
      data-slot="resize-handle"
      data-side={side}
      data-animate-group
      onKeyDown={(event) => {
        if (!adjustable) return;
        const step = event.shiftKey ? 64 : 16;
        const growsWithArrow = side === "right" ? "ArrowRight" : "ArrowLeft";
        if (event.key === "Home") {
          event.preventDefault();
          onValueChange(minValue);
        } else if (event.key === "End") {
          event.preventDefault();
          onValueChange(maxValue);
        } else if (event.key === growsWithArrow) {
          event.preventDefault();
          onValueChange(Math.min(maxValue, value + step));
        } else if (event.key === (growsWithArrow === "ArrowLeft" ? "ArrowRight" : "ArrowLeft")) {
          event.preventDefault();
          onValueChange(Math.max(minValue, value - step));
        }
      }}
      onPointerDown={(e) => {
        e.preventDefault();
        onPointerDown(e);
      }}
      className={`group absolute inset-y-0 z-10 w-5 cursor-col-resize outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${
        side === "left" ? "-left-2.5" : "-right-2.5"
      }`}
    >
      <div
        className={`absolute inset-y-0 left-1/2 w-[7px] -translate-x-1/2 bg-neutral-400/20 transition-opacity ${
          resizing ? "opacity-100" : "opacity-0 group-hover:opacity-100"
        }`}
      />
      <div
        className={`absolute inset-y-0 left-1/2 w-[2.5px] -translate-x-1/2 bg-neutral-400 transition-opacity ${
          resizing ? "opacity-100" : "opacity-0 group-hover:opacity-100"
        }`}
      />
      <div
        className={`absolute top-1/2 left-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-neutral-400 bg-background py-1.5 shadow-light transition-opacity ${
          resizing ? "opacity-100" : "opacity-0 group-hover:opacity-100"
        }`}
      >
        <AnimatedIcon
          icon={GripVertical}
          size={16}
          iconClassName="text-neutral-400"
        />
      </div>
    </div>
  );
}
