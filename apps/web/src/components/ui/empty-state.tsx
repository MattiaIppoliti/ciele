"use client";

import type { ReactNode } from "react";
import {
  EmptyState as ArcEmptyState,
  type EmptyStateProps,
} from "@/components/arc/empty-state/empty-state";
import { cn } from "@/lib/utils";

/** Keep existing console callers and their actions on the shared Arc surface. */
export function EmptyState({
  description = "",
  action,
  children,
  size = "md",
  className,
  ...props
}: Omit<EmptyStateProps, "description"> & {
  description?: string;
  children?: ReactNode;
  size?: "sm" | "md";
}) {
  return (
    <ArcEmptyState
      {...props}
      label={props.label ?? props.title}
      description={description}
      action={action ?? children}
      className={cn(size === "sm" && "empty-state-sm", className)}
    />
  );
}
