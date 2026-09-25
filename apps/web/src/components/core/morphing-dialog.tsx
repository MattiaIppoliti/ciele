"use client";
// motion-primitives MorphingDialog, a trigger card that morphs (shared
// layoutId) into a centered dialog. https://motion-primitives.com

import {
  AnimatePresence,
  MotionConfig,
  motion,
  type Transition,
  type Variant,
  useReducedMotion,
} from "motion/react";
import { XIcon } from "lucide-react";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

function useClickOutside<T extends HTMLElement>(
  ref: React.RefObject<T | null>,
  handler: (event: MouseEvent | TouchEvent) => void,
  enabled = true,
) {
  useEffect(() => {
    if (!enabled) return;
    const listener = (event: MouseEvent | TouchEvent) => {
      if (!ref.current || ref.current.contains(event.target as Node)) return;
      handler(event);
    };
    document.addEventListener("mousedown", listener);
    document.addEventListener("touchstart", listener);
    return () => {
      document.removeEventListener("mousedown", listener);
      document.removeEventListener("touchstart", listener);
    };
  }, [ref, handler, enabled]);
}

function getDialogFocusableElements(container: HTMLElement) {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ).filter(
    (element) =>
      !element.closest('[hidden], [inert], [aria-hidden="true"]') &&
      getComputedStyle(element).visibility !== "hidden" &&
      element.getClientRects().length > 0,
  );
}

interface MorphingDialogContextType {
  isOpen: boolean;
  setIsOpen: React.Dispatch<React.SetStateAction<boolean>>;
  uniqueId: string;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
}

const MorphingDialogContext = createContext<MorphingDialogContextType | null>(
  null
);

function useMorphingDialog() {
  const context = useContext(MorphingDialogContext);
  if (!context) {
    throw new Error("useMorphingDialog must be used within a MorphingDialog");
  }
  return context;
}

export type MorphingDialogProps = {
  children: React.ReactNode;
  transition?: Transition;
};

export function MorphingDialog({ children, transition }: MorphingDialogProps) {
  const [isOpen, setIsOpen] = useState(false);
  const uniqueId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const reduceMotion = useReducedMotion() ?? false;

  const contextValue = useMemo(
    () => ({ isOpen, setIsOpen, uniqueId, triggerRef }),
    [isOpen, uniqueId]
  );

  return (
    <MorphingDialogContext.Provider value={contextValue}>
      <MotionConfig
        transition={reduceMotion ? { duration: 0 } : transition}
        reducedMotion={reduceMotion ? "always" : "never"}
      >
        {children}
      </MotionConfig>
    </MorphingDialogContext.Provider>
  );
}

export type MorphingDialogTriggerProps = {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  ariaLabel: string;
};

export function MorphingDialogTrigger({
  children,
  className,
  style,
  ariaLabel,
}: MorphingDialogTriggerProps) {
  const { setIsOpen, isOpen, uniqueId, triggerRef } = useMorphingDialog();
  const dialogId = `motion-ui-morphing-dialog-content-${uniqueId}`;

  return (
    <motion.button
      type="button"
      ref={triggerRef}
      layoutId={`dialog-${uniqueId}`}
      className={cn(
        "relative appearance-none border-0 p-0 text-inherit focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        className,
      )}
      onClick={() => setIsOpen((open) => !open)}
      style={style}
      aria-haspopup="dialog"
      aria-expanded={isOpen}
      aria-controls={dialogId}
      aria-label={ariaLabel}
    >
      {children}
    </motion.button>
  );
}

export type MorphingDialogContentProps = {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  ariaLabel?: string;
};

export function MorphingDialogContent({
  children,
  className,
  style,
  ariaLabel,
}: MorphingDialogContentProps) {
  const { setIsOpen, isOpen, uniqueId, triggerRef } = useMorphingDialog();
  const containerRef = useRef<HTMLDivElement>(null);
  const wasOpenRef = useRef(false);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setIsOpen(false);
        return;
      }
      if (event.key === "Tab") {
        const container = containerRef.current;
        if (!container) return;
        const focusableElements = getDialogFocusableElements(container);
        const firstFocusableElement = focusableElements.at(0);
        const lastFocusableElement = focusableElements.at(-1);
        if (!firstFocusableElement || !lastFocusableElement) {
          event.preventDefault();
          container.focus();
        } else if (!container.contains(document.activeElement)) {
          event.preventDefault();
          (event.shiftKey ? lastFocusableElement : firstFocusableElement).focus();
        } else if (event.shiftKey) {
          if (document.activeElement === firstFocusableElement) {
            event.preventDefault();
            lastFocusableElement.focus();
          }
        } else if (document.activeElement === lastFocusableElement) {
          event.preventDefault();
          firstFocusableElement.focus();
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, setIsOpen]);

  useEffect(() => {
    if (isOpen) {
      wasOpenRef.current = true;
      document.body.classList.add("overflow-hidden");
      const container = containerRef.current;
      const focusableElements = container
        ? getDialogFocusableElements(container)
        : [];
      (focusableElements[0] ?? container)?.focus();
    } else {
      if (wasOpenRef.current) {
        wasOpenRef.current = false;
        document.body.classList.remove("overflow-hidden");
        triggerRef.current?.focus();
      }
    }
  }, [isOpen, triggerRef]);

  useEffect(() => {
    if (!isOpen || !containerRef.current) return;
    const portalRoot = containerRef.current.closest<HTMLElement>(
      "[data-morphing-dialog-root]",
    );
    if (!portalRoot) return;
    const siblings = Array.from(document.body.children).filter(
      (element): element is HTMLElement =>
        element instanceof HTMLElement && element !== portalRoot,
    );
    const previous = siblings.map((element) => ({
      element,
      inert: element.inert,
      ariaHidden: element.getAttribute("aria-hidden"),
    }));
    for (const element of siblings) {
      element.inert = true;
      element.setAttribute("aria-hidden", "true");
    }
    return () => {
      for (const { element, inert, ariaHidden } of previous) {
        element.inert = inert;
        if (ariaHidden === null) element.removeAttribute("aria-hidden");
        else element.setAttribute("aria-hidden", ariaHidden);
      }
    };
  }, [isOpen]);

  useClickOutside(
    containerRef,
    () => setIsOpen(false),
    isOpen,
  );

  return (
    <motion.div
      ref={containerRef}
      layoutId={`dialog-${uniqueId}`}
      id={`motion-ui-morphing-dialog-content-${uniqueId}`}
      className={cn("overflow-hidden", className)}
      style={style}
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel ?? "Details"}
      aria-describedby={`motion-ui-morphing-dialog-description-${uniqueId}`}
      tabIndex={-1}
    >
      {children}
    </motion.div>
  );
}

export type MorphingDialogContainerProps = {
  children: React.ReactNode;
};

export function MorphingDialogContainer({
  children,
}: MorphingDialogContainerProps) {
  const { isOpen, uniqueId } = useMorphingDialog();
  // SSR-safe portal gate, same pattern as motion/bottom-sheet.tsx: renders
  // null on the server and hydrates without a setState-in-effect.
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );

  if (!mounted) return null;

  return createPortal(
    <AnimatePresence initial={false} mode="sync">
      {isOpen && (
        <>
          <motion.div
            key={`backdrop-${uniqueId}`}
            className="fixed inset-0 z-[80] h-full w-full bg-white/40 backdrop-blur-sm dark:bg-black/40"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          />
          <div
            data-morphing-dialog-root=""
            className="fixed inset-0 z-[80] flex items-center justify-center p-4"
          >
            {children}
          </div>
        </>
      )}
    </AnimatePresence>,
    document.body
  );
}

export type MorphingDialogTitleProps = {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  dialogTitle?: boolean;
};

export function MorphingDialogTitle({
  children,
  className,
  style,
  dialogTitle = false,
}: MorphingDialogTitleProps) {
  const { uniqueId, isOpen } = useMorphingDialog();

  return (
    <motion.div
      layoutId={`dialog-title-container-${uniqueId}`}
      id={dialogTitle && isOpen ? `motion-ui-morphing-dialog-title-${uniqueId}` : undefined}
      className={className}
      style={style}
      layout
    >
      {children}
    </motion.div>
  );
}

export type MorphingDialogSubtitleProps = {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
};

export function MorphingDialogSubtitle({
  children,
  className,
  style,
}: MorphingDialogSubtitleProps) {
  const { uniqueId } = useMorphingDialog();

  return (
    <motion.div
      layoutId={`dialog-subtitle-container-${uniqueId}`}
      className={className}
      style={style}
    >
      {children}
    </motion.div>
  );
}

export type MorphingDialogDescriptionProps = {
  children: React.ReactNode;
  className?: string;
  disableLayoutAnimation?: boolean;
  variants?: {
    initial: Variant;
    animate: Variant;
    exit: Variant;
  };
};

export function MorphingDialogDescription({
  children,
  className,
  variants,
  disableLayoutAnimation,
}: MorphingDialogDescriptionProps) {
  const { uniqueId } = useMorphingDialog();

  return (
    <motion.div
      key={`dialog-description-${uniqueId}`}
      layoutId={
        disableLayoutAnimation
          ? undefined
          : `dialog-description-content-${uniqueId}`
      }
      variants={variants}
      className={className}
      initial="initial"
      animate="animate"
      exit="exit"
      id={`motion-ui-morphing-dialog-description-${uniqueId}`}
    >
      {children}
    </motion.div>
  );
}

export type MorphingDialogImageProps = {
  src: string;
  alt: string;
  className?: string;
  style?: React.CSSProperties;
};

export function MorphingDialogImage({
  src,
  alt,
  className,
  style,
}: MorphingDialogImageProps) {
  const { uniqueId } = useMorphingDialog();

  return (
    <motion.img
      src={src}
      alt={alt}
      className={className}
      layoutId={`dialog-img-${uniqueId}`}
      style={style}
    />
  );
}

export type MorphingDialogCloseProps = {
  children?: React.ReactNode;
  className?: string;
  variants?: {
    initial: Variant;
    animate: Variant;
    exit: Variant;
  };
};

export function MorphingDialogClose({
  children,
  className,
  variants,
}: MorphingDialogCloseProps) {
  const { setIsOpen, uniqueId } = useMorphingDialog();

  const handleClose = useCallback(() => {
    setIsOpen(false);
  }, [setIsOpen]);

  return (
    <motion.button
      onClick={handleClose}
      type="button"
      aria-label="Close dialog"
      key={`dialog-close-${uniqueId}`}
      className={cn(
        "absolute right-6 top-6 z-50 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background max-lg:min-h-11 max-lg:min-w-11",
        className,
      )}
      initial="initial"
      animate="animate"
      exit="exit"
      variants={variants}
    >
      {children || <XIcon size={24} />}
    </motion.button>
  );
}
