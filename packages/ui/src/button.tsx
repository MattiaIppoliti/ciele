import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { isValidElement } from "react"

import { cn } from "./cn"

// Every button shares the same restrained press. Keyboard activation and the
// static opt-out keep their geometry; reduced motion uses an opacity cue.
const buttonPress = "motion-safe:active:not-focus-visible:scale-[0.96] motion-reduce:active:opacity-80"

const buttonBase =
  "group/button inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap outline-none select-none transition-[background-color,border-color,color,box-shadow,transform,opacity] duration-100 ease-out focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5"

type ButtonVariant =
  | "default"
  | "outline"
  | "secondary"
  | "ghost"
  | "destructive"

// Surfaces are written against the alpha scale (--alpha-lighter/light/medium),
// not against a grey. Two things follow, and both were bugs before:
//
//   - A control keeps its weight wherever it lands. `outline` used to paint
//     `bg-background`, which is #f5f5f5: correct over the shell, a visible
//     lighter patch over a `bg-card` panel, and plain wrong over a coloured
//     banner. A translucent black tints whatever is behind it instead.
//   - The alphas invert themselves in `.dark`, so a variant written against
//     them needs no `dark:` twin. `outline` and `ghost` each carried one, and
//     a pair like that drifts every time only one side is touched.
//
// `default` stays solid: it is the page's one committing action and should not
// read as a surface at all. It is painted with the brand tokens, which are
// monochrome (the old `primary` pill) on the marketing site and the docs and
// Linear's lavender in the console, so the variant carries no `dark:` twin. It
// used to: seven of them, a radial glow and a hover halo, which is the kind of
// atmospheric flourish a single accent colour is meant to replace.
const buttonVariantClasses: Record<ButtonVariant, string> = {
  default: "bg-brand text-brand-foreground hover:bg-brand-hover",
  outline:
    "border-alpha-medium hover:bg-alpha-light hover:text-foreground aria-expanded:bg-alpha-light aria-expanded:text-foreground",
  secondary:
    "border-alpha-medium bg-alpha-lighter text-secondary-foreground hover:bg-alpha-light aria-expanded:bg-alpha-light aria-expanded:text-secondary-foreground",
  ghost:
    "hover:bg-alpha-light hover:text-foreground aria-expanded:bg-alpha-light aria-expanded:text-foreground",
  destructive:
    "bg-destructive/10 text-destructive hover:bg-destructive/20 focus-visible:border-destructive/40 focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:hover:bg-destructive/30 dark:focus-visible:ring-destructive/40",
}

type ButtonSize =
  | "default"
  | "xs"
  | "sm"
  | "lg"
  | "icon"
  | "icon-sm"
  | "icon-lg"

const buttonSizeClasses: Record<ButtonSize, string> = {
  // Linear's horizontal rhythm: 12px of side padding on a 32px control, and
  // 10px on the side an icon sits (it had 8 and 6, which read cramped).
  default:
    "h-8 gap-1.5 px-3 has-data-[icon=inline-end]:pr-2.5 has-data-[icon=inline-start]:pl-2.5",
  xs: "h-6 gap-1 rounded-[min(var(--radius-md),10px)] px-2 text-xs in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3 max-lg:min-h-[28px]",
  sm: "h-7 gap-1 rounded-[min(var(--radius-md),12px)] px-2.5 text-[0.8rem] in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5 max-lg:min-h-[28px]",
  lg: "h-9 gap-1.5 px-4 has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3",
  icon: "size-8",
  "icon-sm":
    "size-7 rounded-[min(var(--radius-md),12px)] in-data-[slot=button-group]:rounded-lg max-lg:min-h-[28px] max-lg:min-w-[28px]",
  "icon-lg": "size-9",
}

/** Button classes for non-Button elements (calendar nav buttons). Internal. */
function buttonClasses(
  variant: ButtonVariant = "default",
  size: ButtonSize = "default"
) {
  return cn(buttonBase, buttonPress, buttonVariantClasses[variant], buttonSizeClasses[size])
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
  static: isStatic = false,
  nativeButton,
  render,
  ...props
}: ButtonPrimitive.Props & {
  variant?: ButtonVariant
  size?: ButtonSize
  static?: boolean
}) {
  return (
    <ButtonPrimitive
      data-slot="button"
      data-size={size}
      data-static={isStatic || undefined}
      // Sound follows the same events as the visual press (see feedback/):
      // pointerdown plays `press`, pointerup `release`, keyboard activation
      // `tap`. Attribute-driven so a page gets it by using the primitive.
      data-foley-press=""
      data-foley-release=""
      className={cn(
        buttonBase,
        !isStatic && buttonPress,
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
