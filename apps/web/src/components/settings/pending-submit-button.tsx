"use client";

import { useFormStatus } from "react-dom";
import { Button } from "@agent-hub/ui";
import { MorphText } from "@/components/motion/morph-text";

/**
 * The submit button of a server-action form that leaves for Stripe. The
 * redirect takes a round trip, and without a pending state a second click
 * starts a second Checkout session.
 */
export function PendingSubmitButton({
  children,
  pendingLabel,
  ...props
}: Omit<React.ComponentProps<typeof Button>, "type" | "children"> & {
  /** The idle label, a short single line. */
  children: string;
  pendingLabel: string;
}) {
  const { pending } = useFormStatus();
  return (
    <Button
      {...props}
      type="submit"
      disabled={pending || props.disabled}
      aria-busy={pending || undefined}
    >
      <MorphText text={pending ? pendingLabel : children} />
    </Button>
  );
}
