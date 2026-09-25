"use client";
// beui.dev/components/motion/input

import {
  AnimatePresence,
  animate,
  motion,
  useMotionValue,
  useReducedMotion,
  useSpring,
} from "motion/react";
import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  useState,
  type InputHTMLAttributes,
  type ReactNode,
} from "react";
import { cn } from "@/lib/utils";

export type InputClassNames = {
  root?: string;
  label?: string;
  field?: string;
  input?: string;
  leftIcon?: string;
  rightIcon?: string;
  successIcon?: string;
  errorMessage?: string;
};

export interface InputProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "value" | "defaultValue" | "onChange"
> {
  label?: string;
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  /** Truthy error triggers a shake, red border and (if a string) a message. */
  error?: string | boolean;
  success?: boolean;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  className?: string;
  classNames?: InputClassNames;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  {
    label,
    value: valueProp,
    defaultValue,
    onChange,
    onFocus,
    onBlur,
    onClick,
    onKeyUp,
    error,
    success,
    leftIcon,
    rightIcon,
    className,
    classNames,
    disabled,
    id: idProp,
    type,
    ...rest
  },
  ref,
) {
  const reactId = useId();
  const id = idProp ?? reactId;
  const reduce = useReducedMotion();
  const inputRef = useRef<HTMLInputElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);
  const caretX = useMotionValue(0);
  const caretOpacity = useMotionValue(0);
  const springCaretX = useSpring(
    caretX,
    reduce
      ? { stiffness: 10000, damping: 100, mass: 0.1 }
      : { stiffness: 500, damping: 30, mass: 0.5 },
  );

  const controlled = valueProp !== undefined;
  const [internal, setInternal] = useState(defaultValue ?? "");
  const value = controlled ? (valueProp ?? "") : internal;

  const [focused, setFocused] = useState(false);
  const [hasSelection, setHasSelection] = useState(false);

  const fieldRef = useRef<HTMLDivElement>(null);

  const hasError = Boolean(error);
  const errorMessage = typeof error === "string" ? error : null;
  const smoothCaretEnabled =
    !type || ["text", "search", "email", "password", "tel", "url"].includes(type);

  useImperativeHandle(ref, () => inputRef.current as HTMLInputElement);

  const updateCaret = useCallback(() => {
    const input = inputRef.current;
    const measure = measureRef.current;
    const field = fieldRef.current;
    if (!input || !measure || !field || !smoothCaretEnabled) return;

    const start = input.selectionStart ?? 0;
    const end = input.selectionEnd ?? 0;
    const hasSelection = start !== end;
    setHasSelection((current) =>
      current === hasSelection ? current : hasSelection,
    );
    const caretIndex =
      hasSelection && input.selectionDirection === "backward" ? start : end;
    const textBeforeCaret =
      input.type === "password"
        ? "•".repeat(caretIndex)
        : input.value.slice(0, caretIndex);
    const inputStyle = window.getComputedStyle(input);
    measure.style.font = `${inputStyle.fontStyle} ${inputStyle.fontVariant} ${inputStyle.fontWeight} ${inputStyle.fontSize}/${inputStyle.lineHeight} ${inputStyle.fontFamily}`;
    measure.style.letterSpacing = inputStyle.letterSpacing;
    measure.style.fontFeatureSettings = inputStyle.fontFeatureSettings;
    measure.textContent = textBeforeCaret;

    const inputRect = input.getBoundingClientRect();
    const fieldRect = field.getBoundingClientRect();
    const paddingLeft = Number.parseFloat(inputStyle.paddingLeft) || 0;
    const paddingRight = Number.parseFloat(inputStyle.paddingRight) || 0;
    const caretPosition =
      inputRect.left -
      fieldRect.left +
      paddingLeft +
      measure.getBoundingClientRect().width -
      input.scrollLeft;
    const visibleLeft = inputRect.left - fieldRect.left + paddingLeft;
    const visibleRight = inputRect.right - fieldRect.left - paddingRight;
    const isVisible =
      caretPosition >= visibleLeft - 1 && caretPosition <= visibleRight + 1;

    caretX.set(Math.min(caretPosition, visibleRight));
    caretOpacity.set(isVisible && !hasSelection ? 1 : 0);
  }, [caretOpacity, caretX, smoothCaretEnabled]);

  useEffect(() => {
    if (!focused || !smoothCaretEnabled) {
      caretOpacity.set(0);
      return;
    }
    updateCaret();
  }, [caretOpacity, focused, value, type, smoothCaretEnabled, updateCaret]);

  useEffect(() => {
    if (!smoothCaretEnabled) return;
    const input = inputRef.current;
    const field = fieldRef.current;
    if (!input || !field) return;

    const updateIfFocused = () => {
      if (document.activeElement === input) updateCaret();
    };
    const handleSelectionChange = () => {
      if (document.activeElement === input) requestAnimationFrame(updateIfFocused);
    };
    document.addEventListener("selectionchange", handleSelectionChange);
    document.fonts.addEventListener("loadingdone", updateIfFocused);
    input.addEventListener("scroll", updateIfFocused);
    const resizeObserver = new ResizeObserver(updateIfFocused);
    resizeObserver.observe(field);
    void document.fonts.ready.then(updateIfFocused);

    return () => {
      document.removeEventListener("selectionchange", handleSelectionChange);
      document.fonts.removeEventListener("loadingdone", updateIfFocused);
      input.removeEventListener("scroll", updateIfFocused);
      resizeObserver.disconnect();
    };
  }, [smoothCaretEnabled, updateCaret]);

  // Right edge shows the success check, otherwise the caller's right icon.
  const rightSlot = success ? null : rightIcon;

  // Shake the field when an error appears.
  useEffect(() => {
    if (!fieldRef.current || reduce || !hasError) return;
    animate(
      fieldRef.current,
      { x: [0, -6, 6, -4, 4, -2, 0] },
      { duration: 0.45 },
    );
  }, [hasError, reduce]);

  const handleChange = (next: string) => {
    if (!controlled) setInternal(next);
    onChange?.(next);
  };

  return (
    <div
      className={cn("flex flex-col gap-1.5", className, classNames?.root)}
    >
      {label ? (
        <label
          htmlFor={id}
          className={cn(
            "px-1 text-sm font-medium text-foreground",
            classNames?.label,
          )}
        >
          {label}
        </label>
      ) : null}

      <div
        ref={fieldRef}
        data-state={
          hasError
            ? "error"
            : success
              ? "success"
              : focused
                ? "focused"
                : "idle"
        }
        className={cn(
          "relative h-11 overflow-hidden rounded-full border transition-colors duration-200",
          "border-border",
          focused && !hasError && "border-foreground/40 ring-2 ring-ring/40",
          hasError && "border-destructive ring-2 ring-destructive/25",
          disabled && "opacity-60",
          classNames?.field,
        )}
      >
        {leftIcon ? (
          <span
            className={cn(
              "pointer-events-none absolute left-3 top-1/2 flex -translate-y-1/2 items-center text-muted-foreground [&_svg]:h-4 [&_svg]:w-4",
              classNames?.leftIcon,
            )}
          >
            {leftIcon}
          </span>
        ) : null}

        <input
          ref={inputRef}
          id={id}
          type={type}
          value={value}
          disabled={disabled}
          aria-invalid={hasError || undefined}
          aria-describedby={errorMessage ? `${id}-error` : undefined}
          {...rest}
          onFocus={(event) => {
            setFocused(true);
            setHasSelection(false);
            onFocus?.(event);
          }}
          onBlur={(event) => {
            setFocused(false);
            setHasSelection(false);
            caretOpacity.set(0);
            onBlur?.(event);
          }}
          className={cn(
            "peer h-full w-full bg-transparent text-base leading-6 text-foreground outline-none",
            "placeholder:text-muted-foreground/60",
            smoothCaretEnabled && focused && !hasSelection
              ? "caret-transparent"
              : "caret-foreground",
            leftIcon ? "pl-10" : "pl-3.5",
            rightSlot || success ? "pr-10" : "pr-3.5",
            disabled && "cursor-not-allowed",
            classNames?.input,
          )}
          onChange={(event) => {
            handleChange(event.target.value);
            requestAnimationFrame(updateCaret);
          }}
          onKeyUp={(event) => {
            onKeyUp?.(event);
            requestAnimationFrame(updateCaret);
          }}
          onClick={(event) => {
            onClick?.(event);
            requestAnimationFrame(updateCaret);
          }}
        />

        {smoothCaretEnabled ? (
          <>
            <span
              ref={measureRef}
              aria-hidden="true"
              className="pointer-events-none invisible absolute left-0 top-0 whitespace-pre"
            />
            <motion.span
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 z-10 h-5 w-0.5 -translate-y-1/2 rounded-full bg-foreground"
              style={{ x: springCaretX, opacity: caretOpacity }}
            />
          </>
        ) : null}

        {success ? (
          <motion.svg
            viewBox="0 0 24 24"
            fill="none"
            className={cn(
              "absolute right-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-(--color-success)",
              classNames?.successIcon,
            )}
          >
            <motion.path
              d="M5 12.5l4.5 4.5L19 7.5"
              stroke="currentColor"
              strokeWidth={2.5}
              strokeLinecap="round"
              strokeLinejoin="round"
              initial={reduce ? { pathLength: 1 } : { pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 0.35, ease: "easeOut" }}
            />
          </motion.svg>
        ) : rightSlot ? (
          <span
            className={cn(
              "absolute right-0 top-0 flex h-full items-center text-muted-foreground [&_button]:grid [&_button]:size-11 [&_button]:place-items-center [&_svg]:h-4 [&_svg]:w-4",
              classNames?.rightIcon,
            )}
          >
            {rightSlot}
          </span>
        ) : null}
      </div>

      <AnimatePresence initial={false}>
        {errorMessage ? (
          <motion.p
            id={`${id}-error`}
            role="alert"
            initial={
              reduce
                ? { opacity: 0 }
                : { opacity: 0, y: -4, filter: "blur(4px)" }
            }
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            exit={
              reduce
                ? { opacity: 0 }
                : { opacity: 0, y: -4, filter: "blur(4px)" }
            }
            transition={{ duration: 0.2 }}
            className={cn(
              "px-1 text-xs text-destructive",
              classNames?.errorMessage,
            )}
          >
            {errorMessage}
          </motion.p>
        ) : null}
      </AnimatePresence>
    </div>
  );
});
