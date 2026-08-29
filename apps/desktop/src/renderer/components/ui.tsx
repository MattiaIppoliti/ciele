// The app's whole component set. Four primitives, vendored rather than
// imported: the web app's UI package is coupled to the Next app it lives in,
// and the native surface here is a handful of screens.

import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";
import { cn } from "../lib/cn";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-accent text-accent-ink hover:opacity-90",
  secondary: "bg-surface-raised text-ink border border-line hover:bg-line/50",
  ghost: "text-ink-muted hover:text-ink hover:bg-surface-raised",
  danger: "bg-transparent text-danger border border-danger/40 hover:bg-danger/10",
};

export function Button({
  variant = "primary",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }): ReactNode {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium",
        "transition disabled:pointer-events-none disabled:opacity-40",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
        BUTTON_VARIANTS[variant],
        className,
      )}
      {...props}
    />
  );
}

export function Card({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}): ReactNode {
  return (
    <div
      className={cn(
        "rounded-2xl border border-line bg-surface shadow-lg shadow-black/20",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string | null;
  children: ReactNode;
}): ReactNode {
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="font-medium text-ink">{label}</span>
      {children}
      {error ? (
        <span className="text-xs text-danger">{error}</span>
      ) : hint ? (
        <span className="text-xs text-ink-muted">{hint}</span>
      ) : null}
    </label>
  );
}

export function Input({
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement>): ReactNode {
  return (
    <input
      className={cn(
        "rounded-lg border border-line bg-canvas px-3 py-2 text-sm text-ink",
        "placeholder:text-ink-muted/60",
        "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent",
        className,
      )}
      {...props}
    />
  );
}

/** The drag strip under the traffic lights, present on every native screen. */
export function TitleBar({ children }: { children?: ReactNode }): ReactNode {
  return (
    <div className="drag-region flex h-11 shrink-0 items-center justify-end gap-2 px-3">
      {children}
    </div>
  );
}
