"use client";

import React from "react";
import Link from "next/link";
import { Button } from "@agent-hub/ui";
import { confirmNewsletterAction, type ConfirmResult } from "../actions";

/**
 * The confirm button and what it says afterwards. A client component only
 * because the subscription must happen on a POST the human causes, not on the
 * GET their mail scanner already made (see the page's comment).
 */
export function ConfirmPanel({ token, email }: { token: string; email: string }) {
  const [result, setResult] = React.useState<ConfirmResult | null>(null);
  const [pending, startTransition] = React.useTransition();

  if (result?.status === "subscribed") {
    return (
      <div className="flex flex-col gap-3">
        <h1 className="text-foreground text-2xl font-medium">You are subscribed</h1>
        <p className="text-muted-foreground text-sm">
          {email} is on the list. Every email we send carries an unsubscribe link.
        </p>
        <Link
          href="/home"
          className="text-foreground text-sm font-medium underline underline-offset-4"
        >
          Back to the site
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-foreground text-2xl font-medium">Confirm your subscription</h1>
      <p className="text-muted-foreground text-sm">
        Press confirm and we will start sending the Ciele newsletter to {email}.
      </p>
      <div>
        <Button
          disabled={pending}
          onClick={() =>
            startTransition(async () => setResult(await confirmNewsletterAction(token)))
          }
        >
          {pending ? "Confirming…" : "Confirm subscription"}
        </Button>
      </div>
      {result ? (
        <p role="alert" className="text-destructive text-sm">
          {result.status === "expired"
            ? "That link expired while this page was open. Sign up again from the footer."
            : result.status === "invalid"
              ? "That link is not valid. Sign up again from the footer."
              : "We could not complete the subscription just now. Try again in a few minutes."}
        </p>
      ) : null}
    </div>
  );
}
