import type { ButtonHTMLAttributes, ReactNode } from "react";
import { createElement, forwardRef } from "react";
import { User, type LucideIcon } from "lucide-react";
import { Radio } from "@base-ui/react/radio";
import { RadioGroup as RadioGroupPrimitive } from "@base-ui/react/radio-group";
import type { WorkColor } from "@agent-hub/core";
import { cn } from "@/lib/utils";
import { DOT_CLASS, INK_CLASS, initials, personTone, type Tone } from "@/lib/work/work-format";

/**
 * The work section's small parts (#1054): an initials avatar, a label chip
 * with a colour dot, the borderless pill a cell's picker opens from. Written
 * on Ciele's tokens, so both themes and both palettes still apply.
 */

export const TONE_FILL: Record<Tone, string> = {
  gray: "bg-tone-gray",
  blue: "bg-tone-blue",
  green: "bg-tone-green",
  amber: "bg-tone-amber",
  red: "bg-tone-red",
  purple: "bg-tone-purple",
};

const AVATAR_SIZE = {
  xs: "size-4 text-2xs",
  sm: "size-5 text-2xs",
  md: "size-6 text-2xs",
  lg: "size-9 text-sm",
} as const;

/** A person as initials on their tone; dashed and empty when nobody is assigned. */
export function WorkAvatar({
  person,
  size = "sm",
  className,
}: {
  person: { userId: string; name: string } | null;
  size?: keyof typeof AVATAR_SIZE;
  className?: string;
}) {
  if (!person) {
    return (
      <span
        aria-hidden
        className={cn(
          "border-alpha-strong text-muted-foreground inline-grid shrink-0 place-items-center rounded-full border border-dashed",
          AVATAR_SIZE[size],
          className
        )}
      >
        <User className="size-2.5" />
      </span>
    );
  }
  const tone = personTone(person.userId);
  return (
    <span
      aria-label={person.name}
      className={cn(
        "ring-background inline-grid shrink-0 place-items-center rounded-full font-semibold leading-none ring-[1.5px]",
        TONE_FILL[tone],
        INK_CLASS[tone],
        AVATAR_SIZE[size],
        className
      )}
    >
      {initials(person.name)}
    </span>
  );
}

/** Overlapping faces, "+n" past the limit. */
export function AvatarStack({
  people,
  max = 4,
  size = "md",
}: {
  people: { userId: string; name: string }[];
  max?: number;
  size?: keyof typeof AVATAR_SIZE;
}) {
  return (
    <span className="inline-flex">
      {people.slice(0, max).map((person, index) => (
        <WorkAvatar key={person.userId} person={person} size={size} className={index ? "-ml-1.5" : undefined} />
      ))}
      {people.length > max && (
        <span className={cn("bg-tone-gray text-tone-gray-ink ring-background -ml-1.5 inline-grid place-items-center rounded-full font-semibold ring-[1.5px]", AVATAR_SIZE[size])}>
          +{people.length - max}
        </span>
      )}
    </span>
  );
}

/** A Label: a bordered chip with a small dot in its colour. */
export function LabelChip({ name, color }: { name: string; color: WorkColor }) {
  return (
    <span className="border-alpha-medium bg-content text-muted-foreground inline-flex h-5 shrink-0 items-center gap-1.5 rounded-sm border pr-1.5 pl-1.5 text-xs whitespace-nowrap">
      <i aria-hidden className={cn("size-1.5 rounded-sm", DOT_CLASS[color])} />
      {name}
    </span>
  );
}

/** The borderless pill a cell's picker opens from. */
export const PillButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { muted?: boolean }>(
  function PillButton({ className, muted, children, ...props }, ref) {
    return (
      <button
        ref={ref}
        type="button"
        className={cn(
          "press-control hover:bg-alpha-light inline-flex h-7 max-w-full min-w-0 items-center gap-1.5 rounded-md px-1.5 text-sm whitespace-nowrap transition-colors disabled:cursor-default disabled:hover:bg-transparent",
          muted && "text-muted-foreground",
          className
        )}
        {...props}
      >
        {children}
      </button>
    );
  }
);

/** A small segmented switch (Month / Week, List / Board / Table). */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  className,
  compact = false,
}: {
  value: T;
  options: readonly { value: T; label: string; icon?: LucideIcon }[];
  onChange: (value: T) => void;
  label: string;
  className?: string;
  /** On a narrow toolbar the unselected options with an icon show only the icon. */
  compact?: boolean;
}) {
  return (
    <div className={cn("bg-alpha-light flex h-7 items-center rounded-md p-0.5", className)} role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          title={compact ? option.label : undefined}
          onClick={() => onChange(option.value)}
          className={cn(
            "press-control inline-flex h-6 items-center gap-1.5 rounded-sm px-2 text-xs font-medium whitespace-nowrap transition-colors",
            value === option.value ? "bg-content text-foreground shadow-light" : "text-muted-foreground hover:text-foreground"
          )}
        >
          {option.icon && createElement(option.icon, { "aria-hidden": true, className: "size-3.5" })}
          <span className={cn(compact && option.icon && value !== option.value && "sr-only @5xl:not-sr-only")}>{option.label}</span>
        </button>
      ))}
    </div>
  );
}

/** A row of controls under a page header, full width and ruled below, on the views' 24px gutter. */
export function WorkBar({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div role="toolbar" className={cn("border-alpha-medium flex min-h-11 flex-wrap items-center gap-1 border-b px-6 py-2", className)}>
      {children}
    </div>
  );
}

/**
 * A single choice whose options are drawings (a colour, an icon, a layout
 * name in a pill) rather than labelled rows, on Base UI's radio primitives so
 * arrow keys move the choice. Style the chosen one with `data-[checked]:`.
 * A labelled list of options belongs in `ui/radio-group` instead.
 */
export function SwatchRadioGroup<T extends string>({
  value,
  onValueChange,
  options,
  label,
  className,
  itemClassName,
}: {
  value: T;
  onValueChange: (value: T) => void;
  options: readonly { value: T; label: string; content: ReactNode }[];
  label: string;
  className?: string;
  itemClassName?: string;
}) {
  return (
    <RadioGroupPrimitive
      value={value}
      onValueChange={(next) => onValueChange(next as T)}
      aria-label={label}
      className={cn("flex gap-1", className)}
    >
      {options.map((option) => (
        <Radio.Root
          key={option.value}
          value={option.value}
          aria-label={option.label}
          data-foley-toggle="switch"
          className={cn("press-control focus-visible:ring-ring/50 outline-none focus-visible:ring-2", itemClassName)}
        >
          {option.content}
        </Radio.Root>
      ))}
    </RadioGroupPrimitive>
  );
}
