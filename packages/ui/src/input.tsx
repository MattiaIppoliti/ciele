import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"
import { Eye, EyeOff } from "lucide-react"

import { cn } from "./cn"
import { Button } from "./button"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      // Browser extensions inject attributes (autocomplete suppressors etc.)
      // before React hydrates; don't fail hydration over them.
      suppressHydrationWarning
      className={cn(
        "h-8 w-full min-w-0 rounded-lg border border-alpha-medium bg-alpha-lighter px-3 py-1 text-base transition-colors outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        className
      )}
      {...props}
    />
  )
}

/** Password input with a show/hide toggle, for secrets like API keys or client secrets. */
function PasswordInput({
  className,
  ...props
}: Omit<React.ComponentProps<"input">, "type">) {
  const [visible, setVisible] = React.useState(false)
  return (
    <div className="relative">
      <Input data-text-completion="off" type={visible ? "text" : "password"} className={cn("pr-14", className)} {...props} />
      <span className="absolute top-1/2 right-1 -translate-y-1/2">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? "Hide value" : "Show value"}
          className="text-muted-foreground"
        >
          {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </Button>
      </span>
    </div>
  )
}

export { Input, PasswordInput }
