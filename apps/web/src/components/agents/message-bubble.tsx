"use client";

import { motion, useReducedMotion } from "motion/react";
import { type ComponentPropsWithRef, type ReactNode, useContext } from "react";
import { SPRING_LAYOUT } from "@/lib/ease";
import { cn } from "@/lib/utils";
import { MessageSideContext } from "@/components/agents/message-context";

// Trimmed from upstream to the one shape every caller renders: the "soft"
// variant, no entrance animation, no render-prop element. The data-* hooks
// and class strings are the upstream ones, so styling targets still match.

export function MessageBubble({ children }: { children?: ReactNode }) {
  const reduce = useReducedMotion() ?? false;
  const align = useContext(MessageSideContext) ?? "start";

  return (
    <motion.div
      data-slot="message-bubble"
      data-align={align}
      data-variant="soft"
      initial={false}
      exit={reduce ? { opacity: 0 } : { opacity: 0, y: -3, scale: 0.99 }}
      transition={reduce ? { duration: 0.12 } : SPRING_LAYOUT}
      className={cn(
        "group/bubble flex w-full flex-col",
        align === "end" ? "items-end" : "items-start",
      )}
    >
      {children}
    </motion.div>
  );
}

export function MessageBubbleContent({
  className,
  children,
  ref,
  ...props
}: ComponentPropsWithRef<"div">) {
  const reduce = useReducedMotion() ?? false;
  const align = useContext(MessageSideContext) ?? "start";

  return (
    <div
      ref={ref}
      data-slot="message-bubble-content"
      className={cn(
        "relative z-0 min-w-9 max-w-[82%] rounded-2xl px-3.5 py-2.5 text-sm leading-6 text-foreground",
        "[&_a]:font-medium [&_a]:underline [&_a]:underline-offset-4 [&_code]:rounded [&_code]:bg-background/60 [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.9em] [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_p+p]:mt-2 [&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-xl [&_pre]:bg-background/60 [&_pre]:p-3 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5",
        className,
      )}
      {...props}
    >
      <motion.span
        aria-hidden="true"
        layout={reduce ? false : "size"}
        layoutDependency={0}
        initial={false}
        animate={{ opacity: 1, scale: 1 }}
        transition={reduce ? { duration: 0 } : { layout: SPRING_LAYOUT }}
        className={cn(
          "pointer-events-none absolute inset-0 -z-10 rounded-[inherit]",
          align === "end" ? "origin-bottom-right" : "origin-bottom-left",
          "bg-muted",
        )}
      />
      <motion.div initial={false} animate={{ opacity: 1 }} className="relative">
        {children}
      </motion.div>
    </div>
  );
}
