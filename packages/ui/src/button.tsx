"use client"

import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { Children, isValidElement, useLayoutEffect, useRef, type ReactNode, type Ref } from "react"

import { cn } from "./cn"

type ButtonVariant = "primary" | "secondary" | "ghost" | "destructive" | "default" | "outline"
type ButtonSize = "sm" | "md" | "lg" | "default" | "xs" | "icon" | "icon-sm" | "icon-lg"

const variants = {
  primary: "primary", default: "primary", secondary: "secondary", outline: "secondary",
  ghost: "ghost", destructive: "destructive",
} satisfies Record<ButtonVariant, string>
const sizes = {
  sm: "sm", xs: "sm", "icon-sm": "sm", md: "md", default: "md", icon: "md",
  lg: "lg", "icon-lg": "lg",
} satisfies Record<ButtonSize, string>

/** Classes for library-owned buttons, such as calendar navigation. */
function buttonClasses(variant: ButtonVariant = "default", size: ButtonSize = "default") {
  return cn("ui-button", `ui-button--${variants[variant]}`, `ui-button--${sizes[size]}`,
    size.startsWith("icon") && "ui-button--icon-only")
}

function rendersNativeButton(render: ButtonPrimitive.Props["render"]) {
  return !isValidElement(render) || render.type === "button"
}

// Existing call sites put icons next to labels as children. Keep that API,
// along with the supplied component's explicit icon/iconRight props.
function isIcon(node: ReactNode) {
  if (!isValidElement(node)) return false
  if (node.type === "svg") return true
  const props = node.props
  if (props !== null && typeof props === "object" && "size" in props &&
      typeof props.size === "number" && !("text" in props) && !("children" in props)) return true
  return props !== null && typeof props === "object" && "className" in props &&
    typeof props.className === "string" && /\bsize-/.test(props.className) &&
    !("text" in props) && !("children" in props)
}

function labelText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node)
  if (Array.isArray(node)) return node.map(labelText).join("")
  if (!isValidElement(node) || isIcon(node)) return ""
  const props = node.props
  if (!props || typeof props !== "object") return ""
  if ("text" in props && typeof props.text === "string") return props.text
  if ("children" in props) return labelTextValue(props.children)
  return ""
}

function labelTextValue(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") return String(value)
  if (Array.isArray(value)) return value.map(labelTextValue).join("")
  return isValidElement(value) ? labelText(value) : ""
}

const iconIds = new WeakMap<object, number>()
let nextIconId = 1
function iconKey(node: ReactNode) {
  if (!isValidElement(node)) return "none"
  if (typeof node.type === "string") return node.type
  if (!iconIds.has(node.type)) iconIds.set(node.type, nextIconId++)
  return iconIds.get(node.type)
}

export type ButtonProps = Omit<ButtonPrimitive.Props, "ref"> & {
  ref?: Ref<HTMLElement>
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
  icon?: ReactNode
  iconRight?: ReactNode
  /** Keep feedback static where moving a control would distract. */
  static?: boolean
  /** Allow long actions and suggested questions to wrap. */
  wrap?: boolean
}

function Button({
  className, variant = "primary", size = "md", nativeButton, render,
  loading = false, icon, iconRight, static: staticFeedback = false, wrap = false,
  children, disabled, onClick, ref, type = "button", ...props
}: ButtonProps) {
  const inner = useRef<HTMLElement | null>(null)
  const label = useRef<HTMLSpanElement | null>(null)
  const last = useRef<{ width: number; content: string } | null>(null)
  const widthAnimation = useRef<Animation | null>(null)
  const nodes = Children.toArray(children)
  const startIcon = icon ?? (isIcon(nodes[0]) ? nodes.shift() : undefined)
  const endIcon = iconRight ?? (nodes.length > 1 && isIcon(nodes[nodes.length - 1]) ? nodes.pop() : undefined)
  const text = labelText(nodes)
  const busy = loading || props["aria-busy"] === true || props["aria-busy"] === "true"
  const content = `${text}|${busy ? "loading" : iconKey(startIcon)}|${iconKey(endIcon)}`
  const iconOnly = size.startsWith("icon") || (nodes.length === 0 && Boolean(startIcon || endIcon))

  // No entrance on mount. A changed label/icon morphs; interruption starts
  // at the displayed width rather than jumping back to the previous target.
  useLayoutEffect(() => {
    const el = inner.current
    if (!el) return
    const previous = last.current
    const displayedWidth = el.getBoundingClientRect().width
    widthAnimation.current?.cancel()
    const width = el.getBoundingClientRect().width
    last.current = { width, content }
    if (!previous || previous.content === content ||
        window.matchMedia("(prefers-reduced-motion: reduce)").matches) return
    if (Math.abs(previous.width - width) >= 0.5) {
      widthAnimation.current = el.animate([
        { width: `${displayedWidth === width ? previous.width : displayedWidth}px` },
        { width: `${width}px` },
      ], { duration: 480, easing: "cubic-bezier(0.25, 1, 0.5, 1)" })
    }
    label.current?.animate([
      { opacity: 0, filter: "blur(3px)", transform: "translateY(25%)" },
      { opacity: 1, filter: "blur(0)", transform: "translateY(0)" },
    ], { duration: 480, easing: "cubic-bezier(0.25, 1, 0.5, 1)" })
    for (const glyph of el.querySelectorAll(".ui-button__icon")) {
      glyph.animate([
        { opacity: 0, filter: "blur(2px)", transform: "scale(0.7)" },
        { opacity: 1, filter: "blur(0)", transform: "scale(1)" },
      ], { duration: 520, easing: "cubic-bezier(0.25, 1, 0.5, 1)" })
    }
  }, [content])

  useLayoutEffect(() => () => { widthAnimation.current?.cancel() }, [])

  return (
    <ButtonPrimitive
      data-slot="button"
      data-foley-press=""
      data-foley-release=""
      {...props}
      type={type}
      data-size={size}
      data-variant={variants[variant]}
      data-loading={busy || undefined}
      data-static={staticFeedback || undefined}
      data-wrap={wrap || undefined}
      data-icon-only={iconOnly || undefined}
      className={cn(buttonClasses(variant, size), iconOnly && "ui-button--icon-only", className)}
      nativeButton={nativeButton ?? rendersNativeButton(render)}
      {...(render ? { render } : {})}
      ref={(element) => {
        inner.current = element
        if (typeof ref === "function") return ref(element)
        if (ref) ref.current = element
      }}
      disabled={disabled}
      aria-busy={busy || undefined}
      aria-disabled={busy || disabled || props["aria-disabled"] || undefined}
      onClick={(event) => {
        if (busy) { event.preventDefault(); return }
        onClick?.(event)
      }}
    >
      {startIcon && <span className="ui-button__icon" aria-hidden="true" key={`start-${busy ? "spinner" : iconKey(startIcon)}`}>{busy ? <Spinner /> : startIcon}</span>}
      {nodes.length > 0 && <span ref={label} className="ui-button__label" data-text={text || undefined} key={`label-${text}`}>{nodes}</span>}
      {endIcon && <span className="ui-button__icon" aria-hidden="true" key={`end-${iconKey(endIcon)}`}>{endIcon}</span>}
    </ButtonPrimitive>
  )
}

function Spinner() {
  return <svg className="ui-button__spinner" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
    <circle cx="12" cy="12" r="8.5" opacity={0.2} />
    <path d="M12 3.5a8.5 8.5 0 0 1 8.5 8.5" />
  </svg>
}

export { Button, buttonClasses }
