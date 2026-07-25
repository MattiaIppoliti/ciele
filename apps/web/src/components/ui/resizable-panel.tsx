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
}: {
  resizing: boolean;
  onPointerDown: (e: React.PointerEvent) => void;
  side?: "left" | "right";
  label?: string;
}) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      data-animate-group
      onPointerDown={(e) => {
        e.preventDefault();
        onPointerDown(e);
      }}
      className={`group absolute inset-y-0 z-10 w-3 cursor-col-resize ${
        side === "left" ? "-left-1.5" : "-right-1.5"
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
        className={`absolute top-1/2 left-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-neutral-400 bg-background py-1.5 shadow-sm transition-opacity ${
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
