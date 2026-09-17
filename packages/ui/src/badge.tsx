import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"

import { cn } from "./cn"

const badgeBase =
  "group/badge inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-4xl border border-transparent px-2 py-0.5 text-xs font-medium whitespace-nowrap transition-all focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&>svg]:pointer-events-none [&>svg]:size-3!"

type BadgeVariant = "default" | "secondary" | "destructive" | "outline"

/**
 * Hue for a status badge. `none` (the default) leaves the `variant` colours
 * alone; anything else paints a pale surface of that hue with ink from the
 * dark end of the same hue, and both halves flip in `.dark`.
 *
 * It exists because a status badge is a *semantic* colour and a palette class
 * is not: the console reached for `bg-emerald-50 text-emerald-700
 * dark:bg-emerald-950 dark:text-emerald-400` by hand at every status, no two
 * call sites agreeing on the step, and each one a fresh decision about dark
 * mode. A tone is one word at the call site and one place to retune.
 */
type BadgeTone =
  | "none"
  | "gray"
  | "blue"
  | "green"
  | "amber"
  | "red"
  | "purple"

const badgeToneClasses: Record<BadgeTone, string> = {
  none: "",
  gray: "border-transparent bg-tone-gray text-tone-gray-ink",
  blue: "border-transparent bg-tone-blue text-tone-blue-ink",
  green: "border-transparent bg-tone-green text-tone-green-ink",
  amber: "border-transparent bg-tone-amber text-tone-amber-ink",
  red: "border-transparent bg-tone-red text-tone-red-ink",
  purple: "border-transparent bg-tone-purple text-tone-purple-ink",
}

const badgeVariantClasses: Record<BadgeVariant, string> = {
  default: "bg-primary text-primary-foreground [a]:hover:bg-primary/80",
  secondary:
    "bg-secondary text-secondary-foreground [a]:hover:bg-secondary/80",
  destructive:
    "bg-destructive/10 text-destructive focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:focus-visible:ring-destructive/40 [a]:hover:bg-destructive/20",
  outline:
    "border-border text-foreground [a]:hover:bg-muted [a]:hover:text-muted-foreground",
}

function Badge({
  className,
  variant = "default",
  tone = "none",
  render,
  ...props
}: useRender.ComponentProps<"span"> & {
  variant?: BadgeVariant
  tone?: BadgeTone
}) {
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(
      {
        // Tone last: when one is set it is the whole colour decision, and
        // it has to beat the variant's own background and border.
        className: cn(
          badgeBase,
          badgeVariantClasses[variant],
          badgeToneClasses[tone],
          className
        ),
      },
      props
    ),
    render,
    state: {
      slot: "badge",
      variant,
      tone,
    },
  })
}

export { Badge }
export type { BadgeTone }
