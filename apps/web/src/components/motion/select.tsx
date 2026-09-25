"use client";

import { Check, ChevronDown, ChevronUp } from "lucide-react";
import {
  type HTMLMotionProps,
  motion,
  type Transition,
  useReducedMotion,
  type Variants,
} from "motion/react";
import {
  createContext,
  type HTMLAttributes,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useOpenChangeFeedback } from "@agent-hub/ui/feedback";
import {
  EASE_OUT,
  SPRING_NUDGE,
  SPRING_REFOLD,
  SPRING_UNFOLD,
  SPRING_UNFOLD_FLAT,
} from "@/lib/ease";
import { cn } from "@/lib/utils";

const INSTANT_TRANSITION: Transition = { duration: 0 };

// Spring with bounce powers the unfold/separation; per-property timings in the
// content choreograph it (see SelectContent). Shares bouncy-accordion's tokens
// rather than mirroring its feel by hand.
const CHEVRON_TRANSITION: Transition = SPRING_NUDGE;

const LIST_VARIANTS: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.035, delayChildren: 0.05 } },
};
const ITEM_VARIANTS: Variants = {
  hidden: { opacity: 0, y: -6, filter: "blur(3px)" },
  show: { opacity: 1, y: 0, filter: "blur(0px)" },
};

type Placement = "bottom" | "top";

interface SelectContextValue {
  value: string | undefined;
  selectedValues: string[];
  multiple: boolean;
  open: boolean;
  setOpen: (open: boolean) => void;
  select: (value: string) => void;
  register: (value: string, label: string) => void;
  unregister: (value: string) => void;
  labelFor: (value: string | undefined) => string | undefined;
  reduce: boolean;
  triggerId: string;
  setTriggerId: (id: string) => void;
  listId: string;
  disabled: boolean;
  placement: Placement;
  setPlacement: (p: Placement) => void;
  focusTrigger: () => void;
}

const SelectContext = createContext<SelectContextValue | null>(null);

function useSelectContext(component: string) {
  const ctx = useContext(SelectContext);
  if (!ctx) throw new Error(`${component} must be used within <Select>`);
  return ctx;
}

interface SelectSharedProps {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  disabled?: boolean;
  className?: string;
  children: ReactNode;
}

export interface SelectSingleProps extends SelectSharedProps {
  multiple?: false;
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
}

export interface SelectMultipleProps extends SelectSharedProps {
  multiple: true;
  value?: string[];
  defaultValue?: string[];
  onValueChange?: (value: string[]) => void;
}

export type SelectProps = SelectSingleProps | SelectMultipleProps;

export function Select(props: SelectMultipleProps): ReactNode;
export function Select(props: SelectSingleProps): ReactNode;
export function Select({
  value,
  defaultValue,
  onValueChange,
  multiple = false,
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  disabled = false,
  className,
  children,
}: SelectProps) {
  const reduce = useReducedMotion() ?? false;
  const baseId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const [internal, setInternal] = useState<string | string[] | undefined>(defaultValue);
  const [labels, setLabels] = useState<Map<string, string>>(new Map());
  const [placement, setPlacement] = useState<Placement>("bottom");
  const [triggerId, setTriggerId] = useState(`${baseId}-trigger`);

  const controlled = value !== undefined;
  const current = multiple
    ? undefined
    : controlled
      ? (value as string | undefined)
      : (internal as string | undefined);
  const selectedValues = useMemo(
    () =>
      multiple
        ? controlled
          ? (value as string[])
          : ((internal as string[] | undefined) ?? [])
        : current === undefined
          ? []
          : [current],
    [controlled, current, internal, multiple, value],
  );
  const openControlled = openProp !== undefined;
  const open = openControlled ? openProp : internalOpen;
  const onOpenChangeWithFeedback = useOpenChangeFeedback(onOpenChange);
  const setOpen = useCallback(
    (next: boolean) => {
      if (!openControlled) setInternalOpen(next);
      onOpenChangeWithFeedback?.(next);
    },
    [onOpenChangeWithFeedback, openControlled],
  );
  const focusTrigger = useCallback(() => {
    document.getElementById(triggerId)?.focus();
  }, [triggerId]);

  const select = useCallback(
    (next: string) => {
      if (multiple) {
        const nextValues = selectedValues.includes(next)
          ? selectedValues.filter((selected) => selected !== next)
          : [...selectedValues, next];
        if (!controlled) setInternal(nextValues);
        (onValueChange as ((values: string[]) => void) | undefined)?.(nextValues);
        return;
      }
      if (!controlled) setInternal(next);
      (onValueChange as ((selected: string) => void) | undefined)?.(next);
      setOpen(false);
      requestAnimationFrame(focusTrigger);
    },
    [controlled, focusTrigger, multiple, onValueChange, selectedValues, setOpen],
  );

  const register = useCallback((v: string, label: string) => {
    setLabels((m) => (m.get(v) === label ? m : new Map(m).set(v, label)));
  }, []);
  const unregister = useCallback((v: string) => {
    setLabels((m) => {
      if (!m.has(v)) return m;
      const next = new Map(m);
      next.delete(v);
      return next;
    });
  }, []);

  // close on outside pointer / escape
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        focusTrigger();
      }
    };
    const onPointer = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node))
        setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointer);
    };
  }, [focusTrigger, open, setOpen]);

  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => {
      const options = document
        .getElementById(`${baseId}-list`)
        ?.querySelectorAll<HTMLButtonElement>("[role=option]:not(:disabled)");
      if (!options) return;
      const selected = Array.from(options).find(
        (option) => option.getAttribute("aria-selected") === "true",
      );
      (selected ?? options.item(0))?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [baseId, open]);

  const ctx = useMemo<SelectContextValue>(
    () => ({
      value: current ?? (multiple ? selectedValues[0] : undefined),
      selectedValues,
      multiple,
      open,
      setOpen,
      select,
      register,
      unregister,
      labelFor: (v) => (v === undefined ? undefined : labels.get(v)),
      reduce,
      triggerId,
      setTriggerId,
      listId: `${baseId}-list`,
      disabled,
      placement,
      setPlacement,
      focusTrigger,
    }),
    [
      current,
      selectedValues,
      multiple,
      open,
      setOpen,
      select,
      register,
      unregister,
      labels,
      reduce,
      baseId,
      triggerId,
      setTriggerId,
      disabled,
      placement,
      focusTrigger,
    ],
  );

  return (
    <SelectContext.Provider value={ctx}>
      <div ref={rootRef} data-slot="select" className={cn("relative", className)}>
        {children}
      </div>
    </SelectContext.Provider>
  );
}

export interface SelectTriggerProps
  extends Omit<HTMLMotionProps<"button">, "children" | "size"> {
  size?: "sm" | "default";
  children: ReactNode;
}

export function SelectTrigger({
  className,
  size = "default",
  children,
  id,
  onClick,
  onKeyDown,
  disabled = false,
  ...props
}: SelectTriggerProps) {
  const ctx = useSelectContext("SelectTrigger");
  const setTriggerId = ctx.setTriggerId;
  const actualId = id ?? `${ctx.triggerId}`;
  useLayoutEffect(() => {
    setTriggerId(actualId);
  }, [actualId, setTriggerId]);
  const isTop = ctx.placement === "top";
  // edge facing the panel flattens then rounds; the far edge stays rounded.
  // All four corners are specified so none gets stranded when placement flips.
  const kf = ctx.open ? [0, 0, 12] : [12, 0, 12];
  const kfT: Transition = ctx.reduce
    ? { duration: 0 }
    : ctx.open
      ? { duration: 0.6, times: [0, 0.4, 1], ease: EASE_OUT }
      : { duration: 0.42, times: [0, 0.5, 1], ease: EASE_OUT };
  return (
    <motion.button
      {...props}
      type="button"
      id={actualId}
      data-slot="select-trigger"
      disabled={ctx.disabled || disabled}
      aria-haspopup="listbox"
      aria-expanded={ctx.open}
      aria-controls={ctx.listId}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) ctx.setOpen(!ctx.open);
      }}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (
          !event.defaultPrevented &&
          !ctx.open &&
          (event.key === "ArrowDown" || event.key === "ArrowUp")
        ) {
          event.preventDefault();
          ctx.setOpen(true);
        }
      }}
      // Gooey: the edge facing the panel snaps flat (panel attached) then rounds
      // back once the panel pulls away, the two pinch apart.
      initial={false}
      animate={{
        borderTopLeftRadius: isTop ? kf : 12,
        borderTopRightRadius: isTop ? kf : 12,
        borderBottomLeftRadius: isTop ? 12 : kf,
        borderBottomRightRadius: isTop ? 12 : kf,
      }}
      transition={{
        borderTopLeftRadius: isTop ? kfT : INSTANT_TRANSITION,
        borderTopRightRadius: isTop ? kfT : INSTANT_TRANSITION,
        borderBottomLeftRadius: isTop ? INSTANT_TRANSITION : kfT,
        borderBottomRightRadius: isTop ? INSTANT_TRANSITION : kfT,
      }}
      className={cn(
        "relative z-10 flex w-full items-center justify-between gap-2 rounded-xl border border-border bg-background px-3 py-2 text-left text-sm whitespace-nowrap text-foreground outline-none transition-colors",
        "hover:border-(--color-border-strong) focus-visible:ring-2 focus-visible:ring-foreground/20",
        "disabled:pointer-events-none disabled:opacity-50",
        size === "sm" && "h-9 py-1.5",
        className,
      )}
    >
      {children}
      <motion.span
        aria-hidden
        animate={{ rotate: ctx.open ? 180 : 0 }}
        transition={ctx.reduce ? { duration: 0 } : CHEVRON_TRANSITION}
        className="text-muted-foreground"
      >
        <ChevronDown className="h-4 w-4" />
      </motion.span>
    </motion.button>
  );
}

export interface SelectValueProps {
  placeholder?: string;
  className?: string;
  children?: ReactNode | ((value: string) => ReactNode);
}

export function SelectValue({
  placeholder,
  className,
  children,
}: SelectValueProps) {
  const ctx = useSelectContext("SelectValue");
  const label = ctx.labelFor(ctx.value);
  const content =
    typeof children === "function"
      ? ctx.value === undefined
        ? placeholder ?? "Select"
        : children(ctx.value)
      : children ?? label ?? placeholder ?? "Select";
  return (
    <span
      className={cn(label ? "text-foreground" : "text-muted-foreground", className)}
    >
      {content}
    </span>
  );
}

export interface SelectContentProps {
  className?: string;
  children: ReactNode;
}

export function SelectContent({ className, children }: SelectContentProps) {
  const ctx = useSelectContext("SelectContent");
  const innerRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);
  const typeaheadRef = useRef("");
  const typeaheadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const open = ctx.open;
  const { setPlacement } = ctx;

  useLayoutEffect(() => {
    const node = innerRef.current;
    if (!node) return;
    const measure = () => setHeight(node.offsetHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  });

  // On open, flip upward when there isn't room below and there's more above.
  useLayoutEffect(() => {
    if (!open) return;
    const trigger = document.getElementById(ctx.triggerId);
    const node = innerRef.current;
    if (!trigger || !node) return;
    const rect = trigger.getBoundingClientRect();
    const h = node.offsetHeight;
    const below = window.innerHeight - rect.bottom;
    const above = rect.top;
    setPlacement(below < h + 16 && above > below ? "top" : "bottom");
  }, [open, ctx.triggerId, setPlacement]);

  // Specify EVERY corner + both margins each render. The near edge (facing the
  // trigger) animates flat->round and the gap opens on that side; the far edge
  // stays rounded and its margin pinned to 0. Setting all of them avoids a
  // stranded square corner when the placement flips between opens.
  const isTop = ctx.placement === "top";
  const nearGap = open ? 8 : 0;
  const nearRadius = open ? 12 : 0;

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Tab") {
      requestAnimationFrame(() => ctx.setOpen(false));
      return;
    }
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      const options = Array.from(
        innerRef.current?.querySelectorAll<HTMLButtonElement>(
          '[role="option"]:not(:disabled)',
        ) ?? [],
      );
      if (!options.length) return;
      const activeIndex = options.indexOf(document.activeElement as HTMLButtonElement);
      const nextIndex =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? options.length - 1
            : activeIndex < 0
              ? 0
              : (activeIndex + (event.key === "ArrowDown" ? 1 : -1) + options.length) %
                options.length;
      options[nextIndex]?.focus();
      options[nextIndex]?.scrollIntoView({ block: "nearest" });
      return;
    }

    if (event.key.length === 1 && !event.altKey && !event.ctrlKey && !event.metaKey) {
      typeaheadRef.current += event.key.toLocaleLowerCase();
      if (typeaheadTimerRef.current) clearTimeout(typeaheadTimerRef.current);
      typeaheadTimerRef.current = setTimeout(() => {
        typeaheadRef.current = "";
      }, 500);
      const options = Array.from(
        innerRef.current?.querySelectorAll<HTMLButtonElement>(
          '[role="option"]:not(:disabled)',
        ) ?? [],
      );
      const start = Math.max(0, options.indexOf(document.activeElement as HTMLButtonElement) + 1);
      const ordered = [...options.slice(start), ...options.slice(0, start)];
      const match = ordered.find((option) =>
        option.textContent?.trim().toLocaleLowerCase().startsWith(typeaheadRef.current),
      );
      if (match) {
        event.preventDefault();
        match.focus();
        match.scrollIntoView({ block: "nearest" });
      }
    }
  };

  useEffect(
    () => () => {
      if (typeaheadTimerRef.current) clearTimeout(typeaheadTimerRef.current);
    },
    [],
  );

  // 0.5 bounce over 0.6s used to make a dropdown that opened on a click
  // overshoot like something thrown. Overshoot belongs to motion a gesture
  // carried; nothing carried this one.
  const gapT: Transition = open
    ? { ...SPRING_UNFOLD, delay: 0.12 }
    : SPRING_REFOLD;
  const radiusT: Transition = open
    ? { duration: 0.3, ease: EASE_OUT, delay: 0.14 }
    : { duration: 0.16, ease: EASE_OUT };

  // Items stay mounted (open just animates the panel) so each item's label
  // registration persists, otherwise the trigger would fall back to the
  // placeholder the moment the panel closes.
  return (
    <motion.div
      id={ctx.listId}
      role="listbox"
      aria-multiselectable={ctx.multiple || undefined}
      onKeyDown={onKeyDown}
      aria-labelledby={ctx.triggerId}
      aria-hidden={!open}
      inert={!open}
      initial={false}
      animate={
        ctx.reduce
          ? { opacity: open ? 1 : 0, height: open ? height : 0 }
          : {
              opacity: open ? 1 : 0,
              height: open ? height : 0,
              // gap opens on the side facing the trigger
              marginTop: isTop ? 0 : nearGap,
              marginBottom: isTop ? nearGap : 0,
              // near corners go flat->round; far corners stay rounded
              borderTopLeftRadius: isTop ? 12 : nearRadius,
              borderTopRightRadius: isTop ? 12 : nearRadius,
              borderBottomLeftRadius: isTop ? nearRadius : 12,
              borderBottomRightRadius: isTop ? nearRadius : 12,
            }
      }
      transition={
        ctx.reduce
          ? { duration: 0.12 }
          : {
              opacity: open
                ? { duration: 0.18 }
                : { duration: 0.16, delay: 0.12 },
              height: open
                ? SPRING_UNFOLD_FLAT
                : { duration: 0.26, ease: EASE_OUT, delay: 0.14 },
              marginTop: isTop ? INSTANT_TRANSITION : gapT,
              marginBottom: isTop ? gapT : INSTANT_TRANSITION,
              borderTopLeftRadius: isTop ? INSTANT_TRANSITION : radiusT,
              borderTopRightRadius: isTop ? INSTANT_TRANSITION : radiusT,
              borderBottomLeftRadius: isTop ? radiusT : INSTANT_TRANSITION,
              borderBottomRightRadius: isTop ? radiusT : INSTANT_TRANSITION,
            }
      }
      style={{
        transformOrigin: isTop ? "bottom" : "top",
        overflow: "hidden",
        pointerEvents: open ? "auto" : "none",
      }}
      // flush against the trigger, then separates into its own rounded pill;
      // sits above or below depending on available space
      className={cn(
        "absolute left-0 right-0 z-20 rounded-xl border border-border bg-background shadow-lg",
        isTop ? "bottom-full" : "top-full",
        className,
      )}
    >
      <motion.div
        ref={innerRef}
        variants={ctx.reduce ? undefined : LIST_VARIANTS}
        initial={false}
        animate={open ? "show" : "hidden"}
        className="max-h-[min(20rem,calc(100vh-2rem))] overflow-y-auto p-1"
      >
        {children}
      </motion.div>
    </motion.div>
  );
}

export interface SelectItemProps {
  value: string;
  disabled?: boolean;
  className?: string;
  children: ReactNode;
}

export function SelectItem({
  value,
  disabled = false,
  className,
  children,
}: SelectItemProps) {
  const ctx = useSelectContext("SelectItem");
  const register = ctx.register;
  const unregister = ctx.unregister;
  const selected = ctx.selectedValues.includes(value);
  const optionRef = useRef<HTMLButtonElement>(null);

  useLayoutEffect(() => {
    register(value, optionRef.current?.textContent?.trim() || value);
    return () => unregister(value);
  }, [register, unregister, value, children]);

  return (
    <motion.li role="presentation" variants={ctx.reduce ? undefined : ITEM_VARIANTS}>
      <button
        ref={optionRef}
        type="button"
        role="option"
        aria-selected={selected}
        tabIndex={-1}
        disabled={disabled}
        onClick={() => ctx.select(value)}
        className={cn(
          "flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm outline-none transition-colors",
          selected
            ? "bg-muted text-foreground"
            : "text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:bg-muted",
          "disabled:pointer-events-none disabled:opacity-50",
          className,
        )}
      >
        {children}
        {selected ? <Check className="h-3.5 w-3.5 shrink-0" /> : null}
      </button>
    </motion.li>
  );
}

export function SelectGroup({ children, className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div data-slot="select-group" role="group" className={className} {...props}>
      {children}
    </div>
  );
}

export function SelectGroupLabel({
  children,
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="select-group-label"
      className={cn("px-2 py-1.5 text-xs font-medium text-muted-foreground", className)}
      {...props}
    >
      {children}
    </div>
  );
}

export function SelectSeparator({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="select-separator"
      role="separator"
      className={cn("-mx-1 my-1 h-px bg-border", className)}
      {...props}
    />
  );
}

export function SelectScrollUpArrow({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="select-scroll-up-arrow"
      aria-hidden="true"
      className={cn("flex h-5 items-center justify-center text-muted-foreground", className)}
      {...props}
    >
      <ChevronUp className="size-4" />
    </div>
  );
}

export function SelectScrollDownArrow({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="select-scroll-down-arrow"
      aria-hidden="true"
      className={cn("flex h-5 items-center justify-center text-muted-foreground", className)}
      {...props}
    >
      <ChevronDown className="size-4" />
    </div>
  );
}
