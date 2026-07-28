"use client";

import { Check } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  cloneElement,
  createContext,
  isValidElement,
  type ReactElement,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  type Ref,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";
import { EASE_OUT, SPRING_LAYOUT, SPRING_PANEL } from "@/lib/ease";
import { cn } from "@/lib/utils";

type OpenModality = "pointer" | "keyboard" | "touch";
type MenuPoint = { x: number; y: number };

const VIEWPORT_PADDING = 8;
const LONG_PRESS_DELAY = 520;
const LONG_PRESS_TOLERANCE = 10;
const MORPH_DURATION = 0.3;

/** `useLayoutEffect` warns when a client component is prerendered on the server. */
const useIsomorphicLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

type TriggerElementProps = React.HTMLAttributes<HTMLElement> & {
  ref?: Ref<HTMLElement>;
};

interface ContextMenuContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
  openAt: (point: MenuPoint, modality: OpenModality) => void;
  point: MenuPoint;
  modality: OpenModality;
  invocation: number;
  menuId: string;
  activeId: string | null;
  setActiveId: (id: string | null) => void;
  reduce: boolean;
}

/**
 * The context carries no refs on purpose: the React Compiler lint rules reject
 * reading or mutating a hook-owned ref through context during render, so the
 * trigger and the panel find each other through `data-` attributes instead.
 */
const ContextMenuContext = createContext<ContextMenuContextValue | null>(null);

const TRIGGER_ATTR = "data-context-menu-trigger";
const PORTAL_ATTR = "data-context-menu-portal";

function triggerElementFor(menuId: string) {
  return document.querySelector<HTMLElement>(`[${TRIGGER_ATTR}="${menuId}"]`);
}

/** `useSyncExternalStore` subscription for a value that never changes. */
function subscribeNever() {
  return () => {};
}

/**
 * Touch long-press bookkeeping. Module scope, not a ref: a pending long press
 * is a property of the pointer, so at most one exists at a time, and keeping it
 * out of React lets the trigger's handlers stay ref-free.
 */
const longPress: {
  timer: ReturnType<typeof setTimeout> | null;
  origin: MenuPoint | null;
} = { timer: null, origin: null };

function cancelLongPress() {
  if (longPress.timer) clearTimeout(longPress.timer);
  longPress.timer = null;
  longPress.origin = null;
}

function startLongPress(origin: MenuPoint, onHold: (origin: MenuPoint) => void) {
  cancelLongPress();
  longPress.origin = origin;
  longPress.timer = setTimeout(() => {
    cancelLongPress();
    onHold(origin);
  }, LONG_PRESS_DELAY);
}

/** True once the pointer has travelled far enough to no longer be a long press. */
function longPressStrayedFrom(x: number, y: number) {
  const origin = longPress.origin;
  return (
    origin !== null &&
    Math.hypot(x - origin.x, y - origin.y) > LONG_PRESS_TOLERANCE
  );
}

function useContextMenuContext(component: string) {
  const context = useContext(ContextMenuContext);
  if (!context) {
    throw new Error(`${component} must be used within <ContextMenu>`);
  }
  return context;
}

/**
 * Open the menu from a control of your own (e.g. a "more actions" button)
 * instead of a right-click. Must be called inside `<ContextMenu>`.
 */
export function useContextMenuControls() {
  const context = useContextMenuContext("useContextMenuControls");
  return useMemo(
    () => ({
      open: context.open,
      openAt: context.openAt,
      setOpen: context.setOpen,
    }),
    [context.open, context.openAt, context.setOpen]
  );
}

function getEnabledItems(container: HTMLElement | null) {
  if (!container) return [];
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      '[data-context-menu-item="true"]:not([data-disabled="true"])'
    )
  );
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function collapsedClip(
  origin: MenuPoint,
  size: { width: number; height: number }
) {
  const half = 8;
  const top = clamp(origin.y - half, 0, size.height);
  const right = clamp(size.width - origin.x - half, 0, size.width);
  const bottom = clamp(size.height - origin.y - half, 0, size.height);
  const left = clamp(origin.x - half, 0, size.width);
  return `inset(${top}px ${right}px ${bottom}px ${left}px round 10px)`;
}

export interface ContextMenuProps {
  children: ReactNode;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
}

export function ContextMenu({
  children,
  open: controlledOpen,
  defaultOpen = false,
  onOpenChange,
  className,
}: ContextMenuProps) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const [point, setPoint] = useState<MenuPoint>({ x: 0, y: 0 });
  const [modality, setModality] = useState<OpenModality>("pointer");
  const [invocation, setInvocation] = useState(0);
  const [activeId, setActiveId] = useState<string | null>(null);
  const controlled = controlledOpen !== undefined;
  const open = controlled ? controlledOpen : internalOpen;
  const menuId = useId();
  const reduce = useReducedMotion() ?? false;

  const setOpen = useCallback(
    (next: boolean) => {
      if (!controlled) setInternalOpen(next);
      onOpenChange?.(next);
      if (!next) setActiveId(null);
    },
    [controlled, onOpenChange]
  );

  const openAt = useCallback(
    (nextPoint: MenuPoint, nextModality: OpenModality) => {
      setPoint(nextPoint);
      setModality(nextModality);
      setInvocation((current) => current + 1);
      setActiveId(null);
      setOpen(true);
    },
    [setOpen]
  );

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target?.closest(`[${PORTAL_ATTR}="${menuId}"]`)) setOpen(false);
    };
    const onWindowChange = () => setOpen(false);

    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("resize", onWindowChange);
    window.addEventListener("scroll", onWindowChange);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("resize", onWindowChange);
      window.removeEventListener("scroll", onWindowChange);
    };
  }, [open, setOpen, menuId]);

  const value = useMemo<ContextMenuContextValue>(
    () => ({
      open,
      setOpen,
      openAt,
      point,
      modality,
      invocation,
      menuId,
      activeId,
      setActiveId,
      reduce,
    }),
    [
      open,
      setOpen,
      openAt,
      point,
      modality,
      invocation,
      menuId,
      activeId,
      reduce,
    ]
  );

  return (
    <ContextMenuContext.Provider value={value}>
      <div className={cn("contents", className)}>{children}</div>
    </ContextMenuContext.Provider>
  );
}

export interface ContextMenuTriggerProps {
  children: ReactElement<TriggerElementProps>;
  disabled?: boolean;
  className?: string;
}

export function ContextMenuTrigger({
  children,
  disabled = false,
  className,
}: ContextMenuTriggerProps) {
  const context = useContextMenuContext("ContextMenuTrigger");

  useEffect(() => cancelLongPress, []);

  if (!isValidElement(children)) {
    throw new Error("<ContextMenuTrigger> requires a single React element");
  }

  const childProps = children.props;

  const onPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    childProps.onPointerDown?.(event);
    if (event.defaultPrevented || disabled || event.pointerType !== "touch")
      return;

    startLongPress({ x: event.clientX, y: event.clientY }, (origin) =>
      context.openAt(origin, "touch")
    );
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    childProps.onPointerMove?.(event);
    if (longPressStrayedFrom(event.clientX, event.clientY)) cancelLongPress();
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    childProps.onKeyDown?.(event);
    if (event.defaultPrevented || disabled) return;
    if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10"))
      return;

    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    context.openAt(
      {
        x: rect.left + Math.min(24, rect.width / 2),
        y: rect.top + rect.height / 2,
      },
      "keyboard"
    );
  };

  return cloneElement(children, {
    [TRIGGER_ATTR]: context.menuId,
    "aria-controls": context.open ? context.menuId : undefined,
    "aria-haspopup": "menu",
    "aria-expanded": context.open,
    className: cn(childProps.className, className),
    onContextMenu: (event: ReactMouseEvent<HTMLElement>) => {
      childProps.onContextMenu?.(event);
      if (event.defaultPrevented || disabled) return;
      event.preventDefault();
      cancelLongPress();
      context.openAt({ x: event.clientX, y: event.clientY }, "pointer");
    },
    onKeyDown,
    onPointerDown,
    onPointerMove,
    onPointerUp: (event: ReactPointerEvent<HTMLElement>) => {
      childProps.onPointerUp?.(event);
      cancelLongPress();
    },
    onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => {
      childProps.onPointerCancel?.(event);
      cancelLongPress();
    },
  } as TriggerElementProps);
}

export interface ContextMenuContentProps {
  children: ReactNode;
  className?: string;
  ariaLabel?: string;
}

export function ContextMenuContent({
  children,
  className,
  ariaLabel = "Context menu",
}: ContextMenuContentProps) {
  const context = useContextMenuContext("ContextMenuContent");
  const contentRef = useRef<HTMLDivElement | null>(null);
  const mounted = useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false
  );
  const [position, setPosition] = useState<MenuPoint>(context.point);
  const [origin, setOrigin] = useState<MenuPoint>({ x: 0, y: 0 });
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [morphReady, setMorphReady] = useState(false);
  const typeahead = useRef("");
  const typeaheadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useIsomorphicLayoutEffect(() => {
    if (!context.open) {
      setMorphReady(false);
      return;
    }
    const content = contentRef.current;
    if (!content) return;

    const rect = content.getBoundingClientRect();
    const left = Math.max(
      VIEWPORT_PADDING,
      Math.min(
        Math.max(context.point.x, VIEWPORT_PADDING),
        window.innerWidth - rect.width - VIEWPORT_PADDING
      )
    );
    const top = Math.max(
      VIEWPORT_PADDING,
      Math.min(
        Math.max(context.point.y, VIEWPORT_PADDING),
        window.innerHeight - rect.height - VIEWPORT_PADDING
      )
    );

    setPosition({ x: left, y: top });
    setSize({ width: rect.width, height: rect.height });
    setOrigin({
      x: clamp(context.point.x - left, 12, Math.max(12, rect.width - 12)),
      y: clamp(context.point.y - top, 12, Math.max(12, rect.height - 12)),
    });
    setMorphReady(false);

    if (context.reduce || context.modality === "keyboard") {
      setMorphReady(true);
      return;
    }

    // Let the measured collapsed clip paint once before expanding it. Without
    // this preparation frame, the first invocation can batch both states and
    // appear at full size without the morph.
    let openFrame = 0;
    const prepareFrame = requestAnimationFrame(() => {
      openFrame = requestAnimationFrame(() => setMorphReady(true));
    });
    return () => {
      cancelAnimationFrame(prepareFrame);
      cancelAnimationFrame(openFrame);
    };
  }, [
    context.open,
    context.point,
    context.invocation,
    context.modality,
    context.reduce,
  ]);

  useEffect(() => {
    if (!context.open) return;
    const frame = requestAnimationFrame(() => {
      const first = getEnabledItems(contentRef.current)[0];
      first?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [context.open, context.invocation]);

  useEffect(
    () => () => {
      if (typeaheadTimer.current) clearTimeout(typeaheadTimer.current);
    },
    []
  );

  const moveFocus = (direction: 1 | -1) => {
    const items = getEnabledItems(contentRef.current);
    if (items.length === 0) return;
    const current = items.indexOf(document.activeElement as HTMLElement);
    const next =
      current < 0 ? 0 : (current + direction + items.length) % items.length;
    items[next]?.focus();
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      context.setOpen(false);
      triggerElementFor(context.menuId)?.focus();
      return;
    }
    if (event.key === "Tab") {
      context.setOpen(false);
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      moveFocus(event.key === "ArrowDown" ? 1 : -1);
      return;
    }
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      const items = getEnabledItems(contentRef.current);
      items[event.key === "Home" ? 0 : items.length - 1]?.focus();
      return;
    }
    if (
      event.key.length === 1 &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey
    ) {
      typeahead.current += event.key.toLocaleLowerCase();
      if (typeaheadTimer.current) clearTimeout(typeaheadTimer.current);
      typeaheadTimer.current = setTimeout(() => {
        typeahead.current = "";
      }, 500);
      const match = getEnabledItems(contentRef.current).find((item) =>
        (item.dataset.label ?? item.textContent ?? "")
          .trim()
          .toLocaleLowerCase()
          .startsWith(typeahead.current)
      );
      match?.focus();
    }
  };

  if (!mounted) return null;

  const visualOpen = context.open && morphReady;
  const clipHidden = collapsedClip(origin, size);
  const clipShown = "inset(0px 0px 0px 0px round 12px)";

  return createPortal(
    <div
      data-context-menu-portal={context.menuId}
      aria-hidden={!context.open}
      inert={!context.open}
      style={{ left: position.x, top: position.y }}
      className={cn(
        "fixed z-100 [filter:drop-shadow(0_18px_28px_rgba(0,0,0,0.2))]",
        context.open ? "pointer-events-auto" : "pointer-events-none"
      )}
    >
      <motion.div
        ref={contentRef}
        id={context.menuId}
        role="menu"
        aria-label={ariaLabel}
        data-morph-ready={morphReady ? "true" : "false"}
        tabIndex={-1}
        initial={false}
        animate={{
          opacity: visualOpen ? 1 : 0,
          clipPath:
            context.reduce || context.modality === "keyboard" || visualOpen
              ? clipShown
              : clipHidden,
        }}
        transition={
          context.modality === "keyboard"
            ? { duration: 0 }
            : context.reduce
              ? { duration: 0.1, ease: EASE_OUT }
              : {
                  clipPath: { duration: MORPH_DURATION, ease: EASE_OUT },
                  opacity: { duration: MORPH_DURATION, ease: EASE_OUT },
                }
        }
        onKeyDown={onKeyDown}
        onContextMenu={(event) => event.preventDefault()}
        className={cn(
          "border-border bg-card text-foreground min-w-56 overflow-hidden rounded-xl border p-1.5 outline-none",
          className
        )}
      >
        {children}
      </motion.div>
    </div>,
    document.body
  );
}

type ContextMenuItemTone = "default" | "destructive";

export interface ContextMenuItemProps {
  children: ReactNode;
  onSelect?: () => void;
  disabled?: boolean;
  closeOnSelect?: boolean;
  tone?: ContextMenuItemTone;
  inset?: boolean;
  className?: string;
  textValue?: string;
}

function ContextMenuItemBase({
  children,
  onSelect,
  disabled = false,
  closeOnSelect = true,
  tone = "default",
  inset = false,
  className,
  textValue,
  role = "menuitem",
  ariaChecked,
}: ContextMenuItemProps & {
  role?: "menuitem" | "menuitemcheckbox" | "menuitemradio";
  ariaChecked?: boolean;
}) {
  const context = useContextMenuContext("ContextMenuItem");
  const id = useId();
  const active = context.activeId === id;
  const checkedProps =
    role === "menuitem" ? {} : { "aria-checked": ariaChecked };

  return (
    <button
      type="button"
      id={id}
      role={role}
      {...checkedProps}
      disabled={disabled}
      data-context-menu-item="true"
      data-disabled={disabled ? "true" : undefined}
      data-label={textValue}
      tabIndex={-1}
      onFocus={() => context.setActiveId(id)}
      onPointerMove={(event) => {
        if (!disabled && event.pointerType !== "touch")
          event.currentTarget.focus();
      }}
      onClick={() => {
        if (disabled) return;
        onSelect?.();
        if (closeOnSelect) context.setOpen(false);
      }}
      className={cn(
        "relative isolate flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] outline-none select-none",
        "focus-visible:ring-foreground/15 focus-visible:ring-2",
        "disabled:pointer-events-none disabled:opacity-40",
        inset && "pl-8",
        tone === "destructive" ? "text-destructive" : "text-foreground",
        className
      )}
    >
      {active ? (
        <motion.span
          layoutId={`${context.menuId}-active`}
          className={cn(
            "absolute inset-0 -z-10 rounded-lg",
            tone === "destructive"
              ? "bg-destructive/10"
              : "bg-foreground/[0.065]"
          )}
          transition={context.reduce ? { duration: 0 } : SPRING_LAYOUT}
        />
      ) : null}
      {children}
    </button>
  );
}

export function ContextMenuItem(props: ContextMenuItemProps) {
  return <ContextMenuItemBase {...props} />;
}

export interface ContextMenuCheckboxItemProps
  extends Omit<ContextMenuItemProps, "onSelect"> {
  checked: boolean;
  onCheckedChange?: (checked: boolean) => void;
}

export function ContextMenuCheckboxItem({
  checked,
  onCheckedChange,
  children,
  ...props
}: ContextMenuCheckboxItemProps) {
  const context = useContextMenuContext("ContextMenuCheckboxItem");
  return (
    <ContextMenuItemBase
      {...props}
      role="menuitemcheckbox"
      ariaChecked={checked}
      onSelect={() => onCheckedChange?.(!checked)}
    >
      <span className="flex size-4 shrink-0 items-center justify-center">
        <AnimatePresence initial={false}>
          {checked ? (
            <motion.span
              key="check"
              initial={context.reduce ? false : { opacity: 0, scale: 0.75 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: context.reduce ? 1 : 0.75 }}
              transition={context.reduce ? { duration: 0.08 } : SPRING_PANEL}
            >
              <Check
                aria-hidden="true"
                className="size-3.5"
                strokeWidth={2.4}
              />
            </motion.span>
          ) : null}
        </AnimatePresence>
      </span>
      {children}
    </ContextMenuItemBase>
  );
}

interface ContextMenuRadioGroupContextValue {
  value: string;
  onValueChange?: (value: string) => void;
}

const ContextMenuRadioGroupContext =
  createContext<ContextMenuRadioGroupContextValue | null>(null);

export interface ContextMenuRadioGroupProps {
  value: string;
  onValueChange?: (value: string) => void;
  children: ReactNode;
  className?: string;
}

export function ContextMenuRadioGroup({
  value,
  onValueChange,
  children,
  className,
}: ContextMenuRadioGroupProps) {
  const context = useMemo(
    () => ({ value, onValueChange }),
    [value, onValueChange]
  );
  return (
    <ContextMenuRadioGroupContext.Provider value={context}>
      <div className={className}>{children}</div>
    </ContextMenuRadioGroupContext.Provider>
  );
}

export interface ContextMenuRadioItemProps
  extends Omit<ContextMenuItemProps, "onSelect"> {
  value: string;
}

export function ContextMenuRadioItem({
  value,
  children,
  ...props
}: ContextMenuRadioItemProps) {
  const group = useContext(ContextMenuRadioGroupContext);
  if (!group) {
    throw new Error(
      "ContextMenuRadioItem must be used within <ContextMenuRadioGroup>"
    );
  }
  const checked = group.value === value;
  return (
    <ContextMenuItemBase
      {...props}
      role="menuitemradio"
      ariaChecked={checked}
      onSelect={() => group.onValueChange?.(value)}
    >
      <span className="flex size-4 shrink-0 items-center justify-center">
        <span
          className={cn(
            "size-1.5 rounded-full bg-current transition-opacity",
            checked ? "opacity-100" : "opacity-0"
          )}
        />
      </span>
      {children}
    </ContextMenuItemBase>
  );
}

export interface ContextMenuLabelProps {
  children: ReactNode;
  inset?: boolean;
  className?: string;
}

export function ContextMenuLabel({
  children,
  inset = false,
  className,
}: ContextMenuLabelProps) {
  return (
    <div
      className={cn(
        "text-muted-foreground px-2.5 pt-1.5 pb-1 text-[10px] font-semibold tracking-[0.12em] uppercase",
        inset && "pl-8",
        className
      )}
    >
      {children}
    </div>
  );
}

export interface ContextMenuSeparatorProps {
  className?: string;
}

export function ContextMenuSeparator({ className }: ContextMenuSeparatorProps) {
  return <hr className={cn("bg-border -mx-1 my-1 h-px border-0", className)} />;
}

export interface ContextMenuShortcutProps {
  children: ReactNode;
  className?: string;
}

export function ContextMenuShortcut({
  children,
  className,
}: ContextMenuShortcutProps) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "text-muted-foreground ml-auto pl-4 text-[10px] font-medium tracking-wide",
        className
      )}
    >
      {children}
    </span>
  );
}
