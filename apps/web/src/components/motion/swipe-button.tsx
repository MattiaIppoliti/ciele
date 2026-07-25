"use client";
// badtz-ui.com/docs/buttons/swipe-button (adapted to theme tokens)

import { type CSSProperties, useEffect, useRef, useState } from "react";
import { Check, ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";

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
  const [isSwiped, setIsSwiped] = useState(false);
  const [isValidated, setIsValidated] = useState(false);
  const [startX, setStartX] = useState(0);
  const [currentX, setCurrentX] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (isValidated) {
      const timer = setTimeout(() => {
        setIsValidated(false);
        setIsSwiped(false);
        setCurrentX(0);
        setIsDragging(false);
      }, validationDuration);
      return () => clearTimeout(timer);
    }
  }, [isValidated, validationDuration]);

  const handleStart = (clientX: number) => {
    if (isValidated) return;
    setStartX(clientX);
    setIsDragging(true);
  };

  const handleMove = (clientX: number) => {
    if (!buttonRef.current || !isDragging || isValidated) return;

    const containerWidth = containerRef.current?.offsetWidth || 0;
    const buttonWidth = buttonRef.current.offsetWidth;
    const maxSwipe = containerWidth - buttonWidth - gap * 2;

    let newX = clientX - startX;
    newX = Math.max(0, Math.min(newX, maxSwipe));

    setCurrentX(newX);
    setIsSwiped(newX >= maxSwipe - 10);
  };

  const handleEnd = () => {
    if (isValidated) return;

    if (isSwiped) {
      setIsValidated(true);
      setCurrentX(0);
      onSwipeComplete?.();
    } else {
      setCurrentX(0);
      setIsSwiped(false);
    }
    setIsDragging(false);
  };

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
      role="button"
      aria-label="Swipe to publish"
      {...props}
    >
      <button
        ref={buttonRef}
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
          transform: isValidated ? "none" : `translateX(${currentX}px)`,
          transition: isDragging ? "none" : "all 0.3s ease",
        }}
        aria-label={isValidated ? "Validated" : "Swipe to publish"}
        disabled={isValidated}
      >
        {isValidated ? (
          <Check className="size-4 text-white" aria-hidden="true" />
        ) : (
          <ChevronRight className="size-4" aria-hidden="true" />
        )}
      </button>
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
