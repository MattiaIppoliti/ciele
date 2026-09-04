import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { isValidElement } from "react"

import { cn } from "./cn"

// Press feedback lives on `:active`, so it fires on pointer-*down* rather than
// on the click that follows. Three deliberate choices in here:
//
//   - `duration-100` on transform, because the previous `transition-all` with
//     no duration inherited the 150ms default and applied it to a 1px nudge.
//     A one-pixel move arriving a sixth of a second late is not feedback.
//   - `scale-[0.97]` alongside the nudge: a 1px translate is below the
//     threshold where a press reads as acknowledged at all.
//   - No `not-aria-[haspopup]` exclusion. Menu triggers used to opt out of
//     press feedback entirely, which made every dropdown in the app feel dead
//     on the way down; the popover arriving afterwards is a separate event.
//
// `transition-all` is gone: it animated colour, border, shadow and transform on
// one duration, so the press could never be quicker than the hover tint.
const buttonBase =
  "group/button inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap outline-none select-none transition-[background-color,border-color,color,box-shadow,transform,opacity] duration-100 ease-out focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 active:translate-y-px active:scale-[0.97] motion-reduce:active:scale-100 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"

type ButtonVariant =
  | "default"
  | "outline"
  | "secondary"
  | "ghost"
  | "destructive"

const buttonVariantClasses: Record<ButtonVariant, string> = {
  default:
    // Dark mode: a dark pill lit from inside by a radial top glow;
    // hover inverts to the light pill with a faint halo around it.
    "bg-primary text-primary-foreground hover:bg-primary/80 dark:border-white/10 dark:bg-neutral-900 dark:bg-[radial-gradient(100%_80%_at_50%_0%,rgba(255,255,255,0.14),transparent_65%)] dark:text-foreground dark:hover:bg-none dark:hover:bg-primary dark:hover:text-primary-foreground dark:hover:shadow-[0_0_14px_rgba(255,255,255,0.28)]",
  outline:
    "border-border bg-background hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50",
  secondary:
    "bg-secondary text-secondary-foreground hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)] aria-expanded:bg-secondary aria-expanded:text-secondary-foreground",
  ghost:
    "hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:hover:bg-foreground/10",
  destructive:
    "bg-destructive/10 text-destructive hover:bg-destructive/20 focus-visible:border-destructive/40 focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:hover:bg-destructive/30 dark:focus-visible:ring-destructive/40",
}

type ButtonSize =
  | "default"
  | "xs"
  | "sm"
  | "lg"
  | "icon"
  | "icon-xs"
  | "icon-sm"
  | "icon-lg"

const buttonSizeClasses: Record<ButtonSize, string> = {
  default:
    "h-8 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
  xs: "h-6 gap-1 rounded-[min(var(--radius-md),10px)] px-2 text-xs in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
  sm: "h-7 gap-1 rounded-[min(var(--radius-md),12px)] px-2.5 text-[0.8rem] in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
  lg: "h-9 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
  icon: "size-8",
  "icon-xs":
    "size-6 rounded-[min(var(--radius-md),10px)] in-data-[slot=button-group]:rounded-lg [&_svg:not([class*='size-'])]:size-3",
  "icon-sm":
    "size-7 rounded-[min(var(--radius-md),12px)] in-data-[slot=button-group]:rounded-lg",
  "icon-lg": "size-9",
}

/** Button classes for non-Button elements (calendar nav buttons). Internal. */
function buttonClasses(
  variant: ButtonVariant = "default",
  size: ButtonSize = "default"
) {
  return cn(buttonBase, buttonVariantClasses[variant], buttonSizeClasses[size])
}

/**
 * Whether Base UI should treat the rendered element as a native `<button>`.
 *
 * Its `nativeButton` prop defaults to true, so rendering a link through
 * `render={<Link/>}`: the idiom for a button-shaped navigation, used all over
 * the admin console, trips a console error on every mount and asks Base UI to
 * skip the keyboard/role shims a non-button needs. Inferring it from `render`
 * keeps the call sites free of a prop nobody should have to remember, and an
 * explicit `nativeButton` still wins.
 */
function rendersNativeButton(render: ButtonPrimitive.Props["render"]): boolean {
  if (!isValidElement(render)) return true
  return render.type === "button"
}

function Button({
  className,
  variant = "default",
  size = "default",
  nativeButton,
  render,
  ...props
}: ButtonPrimitive.Props & {
  variant?: ButtonVariant
  size?: ButtonSize
}) {
  return (
    <ButtonPrimitive
      data-slot="button"
      // Sound follows the same events as the visual press (see feedback/):
      // pointerdown plays `press`, pointerup `release`, keyboard activation
      // `tap`. Attribute-driven so a page gets it by using the primitive.
      data-foley-press=""
      data-foley-release=""
      className={cn(
        buttonBase,
        buttonVariantClasses[variant],
        buttonSizeClasses[size],
        className
      )}
      nativeButton={nativeButton ?? rendersNativeButton(render)}
      {...(render ? { render } : {})}
      {...props}
    />
  )
}

export { Button, buttonClasses }
