// Native fields/cards retain their tokens; actions use the product's shared button.

import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";
import { Button as SharedButton } from "@agent-hub/ui";

/** Joins class names, skipping falsy ones. No conflict merging: no call site passes two classes from one utility group. */
export function cn(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(" ");
}

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

export function Button({
  variant = "primary",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }): ReactNode {
  return (
    <SharedButton
      variant={variant === "danger" ? "destructive" : variant}
      className={className}
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
