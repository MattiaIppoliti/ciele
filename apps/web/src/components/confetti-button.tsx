"use client";

import type { ComponentProps } from "react";
import { Button } from "@agent-hub/ui";
import { celebrate, type CelebrationVariant } from "@/lib/celebration";

/** Async forms opt out of click celebrations and call celebrate after success. */
export function ConfettiButton({ variant = "default", celebrateOnClick = true, onClick, ...props }: Omit<ComponentProps<typeof Button>, "variant"> & {
  variant?: CelebrationVariant;
  celebrateOnClick?: boolean;
}) {
  return <Button {...props} onClick={event => {
    onClick?.(event);
    if (celebrateOnClick && !event.defaultPrevented) void celebrate(variant);
  }} />;
}
