"use client";
// badtz-ui.com/docs/buttons/swipe-button (adapted to theme tokens)

import { type CSSProperties, useEffect, useId, useRef, useState } from "react";
import { Check, ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  SWIPE_START,
  maxSwipeFor,
  swipeProgress,
  swipeStateFor,
  swipeStateForKey,
  type SwipeState,
} from "./swipe-progress";

export interface SwipeButtonProps
  extends React.HTMLAttributes<HTMLDivElement> {
  onSwipeComplete?: () => void;
  text?: string;
  className?: string;
  gap?: number;
  validationDuration?: number;
}

export function SwipeButton({
  onSwipeComplete,
  text = "Swipe to validate",
  className,
  gap = 3,
  validationDuration = 2000,
  ...props
}: SwipeButtonProps) {
  const [isValidated, setIsValidated] = useState(false);
  // Rendered mirror of `swipeRef`. Never read it back to decide anything: a burst of
  // pointer events dispatched in one tick (Playwright's dragTo, any synthetic harness)
  // all runs before React flushes, so the ref is the only source of truth mid-gesture.
  const [swipe, setSwipe] = useState<SwipeState>(SWIPE_START);
  const swipeRef = useRef<SwipeState>(SWIPE_START);
  const dragRef = useRef<{ active: boolean; startX: number }>({
    active: false,
    startX: 0,
  });
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const hintId = useId();

  const applySwipe = (next: SwipeState) => {
    swipeRef.current = next;
    setSwipe(next);
  };

  const reset = () => {
    dragRef.current = { active: false, startX: 0 };
    applySwipe(SWIPE_START);
    setIsDragging(false);
  };

  useEffect(() => {
    if (isValidated) {
      const timer = setTimeout(() => {
        setIsValidated(false);
        reset();
      }, validationDuration);
      return () => clearTimeout(timer);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset is stable enough (refs + setState)
  }, [isValidated, validationDuration]);

  // Handlers need the live measurement; render needs the same number for `aria-valuenow`
  // and may not read refs — so every measurement also lands in state. Measuring per
  // interaction (rather than trusting one mount-time observation) keeps this correct when
  // the host remounts or resizes the control, e.g. a modal animating open around it.
  const [trackMax, setTrackMax] = useState(0);
  const maxSwipe = () => {
    const max = maxSwipeFor(
      containerRef.current?.offsetWidth ?? 0,
      buttonRef.current?.offsetWidth ?? 0,
      gap,
    );
    setTrackMax(max);
    return max;
  };

  const commit = () => {
    setIsValidated(true);
    applySwipe(SWIPE_START);
    dragRef.current = { active: false, startX: 0 };
    setIsDragging(false);
    onSwipeComplete?.();
  };

  const handleStart = (clientX: number) => {
    if (isValidated) return;
    dragRef.current = { active: true, startX: clientX - swipeRef.current.offset };
    setIsDragging(true);
  };

  const handleMove = (clientX: number) => {
    if (isValidated || !dragRef.current.active || !buttonRef.current) return;
    applySwipe(swipeStateFor(clientX - dragRef.current.startX, maxSwipe()));
  };

  const handleEnd = () => {
    if (isValidated || !dragRef.current.active) return;
    if (swipeRef.current.atEnd) commit();
    else reset();
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (isValidated) return;
    const result = swipeStateForKey(event.key, swipeRef.current, maxSwipe());
    if (!result.handled) return;
    event.preventDefault();
    if (result.commit) commit();
    else applySwipe(result.state);
  };

  const progress = swipeProgress(swipe.offset, trackMax);

  return (
    <div
      ref={containerRef}
      className={cn(
        "relative h-11 w-full overflow-hidden rounded-xl",
        "border-border bg-muted border shadow-sm",
        "transition-colors duration-200",
        className,
      )}
      onTouchStart={(e) => handleStart(e.touches[0].clientX)}
      onTouchMove={(e) => handleMove(e.touches[0].clientX)}
      onTouchEnd={handleEnd}
      onMouseDown={(e) => handleStart(e.clientX)}
      onMouseMove={(e) => handleMove(e.clientX)}
      onMouseUp={handleEnd}
      onMouseLeave={handleEnd}
      {...props}
    >
      <button
        ref={buttonRef}
        type="button"
        className={cn(
          "absolute rounded-lg",
          "bg-primary text-primary-foreground",
          "flex items-center justify-center",
          "cursor-grab active:cursor-grabbing",
          "shadow-sm transition-all duration-300",
          "hover:bg-primary/90",
          "focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none",
          "disabled:pointer-events-none",
          isValidated &&
            "w-[calc(100%-6px)] cursor-default bg-emerald-500 opacity-100 hover:bg-emerald-500 dark:bg-emerald-500 dark:hover:bg-emerald-500",
        )}
        style={{
          width: isValidated ? `calc(100% - ${gap * 2}px)` : "40px",
          height: `calc(100% - ${gap * 2}px)`,
          left: `${gap}px`,
          top: `${gap}px`,
          transform: isValidated ? "none" : `translateX(${swipe.offset}px)`,
          transition: isDragging ? "none" : "all 0.3s ease",
        }}
        onKeyDown={handleKeyDown}
        role="slider"
        aria-label={text}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={isValidated ? 100 : progress}
        aria-valuetext={
          isValidated
            ? "Confirmed"
            : swipe.atEnd
              ? "At the end — press Enter to confirm"
              : `${progress}% of the way`
        }
        aria-describedby={hintId}
        disabled={isValidated}
      >
        {isValidated ? (
          <Check className="size-4 text-white" aria-hidden="true" />
        ) : (
          <ChevronRight className="size-4" aria-hidden="true" />
        )}
      </button>
      <p id={hintId} className="sr-only">
        Drag the handle to the end, or press the Right Arrow key (or End) to move it
        there, then press Enter to confirm. Escape returns it to the start.
      </p>
      <div className="flex h-full w-full items-center justify-center">
        <span
          style={{ "--swipe-button-text-width": "130px" } as CSSProperties}
          className={cn(
            "text-muted-foreground pointer-events-none mx-auto max-w-md text-sm select-none",
            "animate-swipe-button-text bg-clip-text [background-position:0_0] [background-size:var(--swipe-button-text-width)_100%] bg-no-repeat",
            "bg-gradient-to-r from-transparent via-black/80 via-50% to-transparent dark:via-white/80",
          )}
        >
          {text}
        </span>
      </div>
    </div>
  );
}
