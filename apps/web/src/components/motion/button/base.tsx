"use client";

import { Button as SharedButton, type ButtonProps as SharedButtonProps } from "@agent-hub/ui";

export type ButtonProps = SharedButtonProps;
export type ButtonVariant = NonNullable<ButtonProps["variant"]>;

/** Composer controls use the shared button's compact icon size. */
export function Button(props: ButtonProps) {
  return <SharedButton size="icon-sm" {...props} />;
}
