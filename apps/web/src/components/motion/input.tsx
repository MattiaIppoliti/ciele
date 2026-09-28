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
} from "react";
import { cn } from "@/lib/utils";

export interface InputProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "value" | "defaultValue" | "onChange" | "className"
> {
  label?: string;
  /** Truthy error triggers a shake, red border and (if a string) a message. */
  error?: string | boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  {
    label,
    onFocus,
    onBlur,
    onClick,
    onKeyUp,
    error,
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

  const [value, setValue] = useState("");

  const [focused, setFocused] = useState(false);
  const [hasSelection, setHasSelection] = useState(false);

  const fieldRef = useRef<HTMLDivElement>(null);

  const hasError = Boolean(error);
  const errorMessage = typeof error === "string" ? error : null;

  useImperativeHandle(ref, () => inputRef.current as HTMLInputElement);

  const updateCaret = useCallback(() => {
    const input = inputRef.current;
    const measure = measureRef.current;
    const field = fieldRef.current;
    if (!input || !measure || !field) return;

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
  }, [caretOpacity, caretX]);

  useEffect(() => {
    if (!focused) {
      caretOpacity.set(0);
      return;
    }
    updateCaret();
  }, [caretOpacity, focused, value, type, updateCaret]);

  useEffect(() => {
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
  }, [updateCaret]);

  // Shake the field when an error appears.
  useEffect(() => {
    if (!fieldRef.current || reduce || !hasError) return;
    animate(
      fieldRef.current,
      { x: [0, -6, 6, -4, 4, -2, 0] },
      { duration: 0.45 },
    );
  }, [hasError, reduce]);

  return (
    <div className="flex flex-col gap-1.5">
      {label ? (
        <label htmlFor={id} className="px-1 text-sm font-medium text-foreground">
          {label}
        </label>
      ) : null}

      <div
        ref={fieldRef}
        data-state={hasError ? "error" : focused ? "focused" : "idle"}
        className={cn(
          "relative h-11 overflow-hidden rounded-full border transition-colors duration-200",
          "border-border",
          focused && !hasError && "border-foreground/40 ring-2 ring-ring/40",
          hasError && "border-destructive ring-2 ring-destructive/25",
          disabled && "opacity-60",
          "bg-white",
        )}
      >

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
            focused && !hasSelection ? "caret-transparent" : "caret-foreground",
            "pl-3.5",
            "pr-3.5",
            disabled && "cursor-not-allowed",
          )}
          onChange={(event) => {
            setValue(event.target.value);
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
            className="px-1 text-xs text-destructive"
          >
            {errorMessage}
          </motion.p>
        ) : null}
      </AnimatePresence>
    </div>
  );
});
