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
import { useModalFocus } from "@/components/motion/use-modal-focus";

function useClickOutside<T extends HTMLElement>(
  ref: React.RefObject<T | null>,
  handler: (event: MouseEvent | TouchEvent) => void
) {
  useEffect(() => {
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
  }, [ref, handler]);
}

interface MorphingDialogContextType {
  isOpen: boolean;
  reduce: boolean;
  setIsOpen: React.Dispatch<React.SetStateAction<boolean>>;
  uniqueId: string;
  triggerRef: React.RefObject<HTMLDivElement | null>;
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
  const reduce = useReducedMotion() ?? false;
  const [isOpen, setIsOpen] = useState(false);
  const uniqueId = useId();
  const triggerRef = useRef<HTMLDivElement>(null);

  const contextValue = useMemo(
    () => ({ isOpen, reduce, setIsOpen, uniqueId, triggerRef }),
    [isOpen, reduce, uniqueId]
  );

  return (
    <MorphingDialogContext.Provider value={contextValue}>
      <MotionConfig transition={reduce ? { duration: 0 } : transition}>
        {children}
      </MotionConfig>
    </MorphingDialogContext.Provider>
  );
}

export type MorphingDialogTriggerProps = {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  triggerRef?: React.RefObject<HTMLDivElement | null>;
  ariaLabel?: string;
};

export function MorphingDialogTrigger({
  children,
  className,
  style,
  triggerRef,
  ariaLabel,
}: MorphingDialogTriggerProps) {
  const {
    setIsOpen,
    isOpen,
    reduce,
    uniqueId,
    triggerRef: dialogTriggerRef,
  } = useMorphingDialog();

  const setTriggerRef = useCallback(
    (node: HTMLDivElement | null) => {
      dialogTriggerRef.current = node;
      if (triggerRef) triggerRef.current = node;
    },
    [dialogTriggerRef, triggerRef],
  );

  const handleClick = useCallback(() => {
    setIsOpen(!isOpen);
  }, [isOpen, setIsOpen]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.target !== event.currentTarget) return;
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        setIsOpen(!isOpen);
      }
    },
    [isOpen, setIsOpen]
  );

  return (
    <motion.div
      ref={setTriggerRef}
      layoutId={reduce ? undefined : `dialog-${uniqueId}`}
      className={cn("relative cursor-pointer", className)}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      style={style}
      role="button"
      tabIndex={0}
      aria-haspopup="dialog"
      aria-expanded={isOpen}
      aria-controls={`motion-ui-morphing-dialog-content-${uniqueId}`}
      aria-label={ariaLabel}
    >
      {children}
    </motion.div>
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
  const { setIsOpen, isOpen, reduce, uniqueId, triggerRef } = useMorphingDialog();
  const containerRef = useRef<HTMLDivElement>(null);
  useModalFocus(isOpen, containerRef, triggerRef);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) {
        setIsOpen(false);
      }
    };

    if (!isOpen) return;
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, setIsOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const body = document.body;
    const alreadyLocked = body.classList.contains("overflow-hidden");
    body.classList.add("overflow-hidden");
    return () => {
      if (!alreadyLocked) body.classList.remove("overflow-hidden");
    };
  }, [isOpen]);

  useClickOutside(containerRef, () => {
    if (isOpen) setIsOpen(false);
  });

  return (
    <motion.div
      ref={containerRef}
      id={`motion-ui-morphing-dialog-content-${uniqueId}`}
      layoutId={reduce ? undefined : `dialog-${uniqueId}`}
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
  const { isOpen, reduce, uniqueId } = useMorphingDialog();
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
            initial={reduce ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={reduce ? undefined : { opacity: 0 }}
          />
          <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
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
};

export function MorphingDialogTitle({
  children,
  className,
  style,
}: MorphingDialogTitleProps) {
  const { reduce, uniqueId } = useMorphingDialog();

  return (
    <motion.div
      layoutId={reduce ? undefined : `dialog-title-container-${uniqueId}`}
      className={className}
      style={style}
      layout={!reduce}
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
  const { reduce, uniqueId } = useMorphingDialog();

  return (
    <motion.div
      layoutId={reduce ? undefined : `dialog-subtitle-container-${uniqueId}`}
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
  const { reduce, uniqueId } = useMorphingDialog();

  return (
    <motion.div
      key={`dialog-description-${uniqueId}`}
      layoutId={
        disableLayoutAnimation || reduce
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
  const { reduce, uniqueId } = useMorphingDialog();

  return (
    <motion.img
      src={src}
      alt={alt}
      className={className}
      layoutId={reduce ? undefined : `dialog-img-${uniqueId}`}
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
      className={cn("absolute right-6 top-6 z-50", className)}
      initial="initial"
      animate="animate"
      exit="exit"
      variants={variants}
    >
      {children || <XIcon size={24} />}
    </motion.button>
  );
}
