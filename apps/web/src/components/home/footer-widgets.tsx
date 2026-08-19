"use client";

import React from "react";
import { Button, cn } from "@agent-hub/ui";
import {
  subscribeToNewsletterAction,
  type SubscribeResult,
} from "@/app/(marketing)/newsletter/actions";

/* Live Rome clock. useSyncExternalStore (not useEffect+setState) keeps it
   SSR-safe and off the react-hooks/set-state-in-effect rule: the server
   paints a placeholder, the client swaps in the real time on hydration and
   re-reads once a minute. */
const romeTime = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Rome",
  hour: "2-digit",
  minute: "2-digit",
});

function subscribe(onChange: () => void) {
  const id = setInterval(onChange, 15_000);
  return () => clearInterval(id);
}

export function FooterClock({ className }: { className?: string }) {
  const time = React.useSyncExternalStore(
    subscribe,
    () => romeTime.format(new Date()),
    () => ", :,",
  );
  return (
    <span className={className}>
      Rome, <time suppressHydrationWarning>{time}</time>
    </span>
  );
}

/* Newsletter sign-up. Posts to the double opt-in Server Action in
   app/(marketing)/newsletter/actions.ts: this form only ever causes a
   confirmation email, and the address joins the Resend Audience when the
   recipient clicks through. The panel therefore says "check your inbox", never
   "subscribed" — the second is not true yet and may never become true. */
export function FooterNewsletter() {
  const [email, setEmail] = React.useState("");
  const [honeypot, setHoneypot] = React.useState("");
  const [result, setResult] = React.useState<SubscribeResult | null>(null);
  const [pending, startTransition] = React.useTransition();

  const message =
    result?.status === "invalid"
      ? result.error
      : result?.status === "rate_limited"
        ? `Too many attempts. Try again in ${Math.ceil(result.retryAfterSeconds / 60)} min.`
        : result?.status === "unavailable"
          ? "We could not send the confirmation email. Try again later."
          : null;

  return (
    <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-center sm:gap-4 lg:w-auto">
      <p className="text-muted-foreground font-mono text-xs font-medium uppercase tracking-wider">
        Newsletter
      </p>
      {result?.status === "check_inbox" ? (
        <p className="text-foreground text-sm">
          Check your inbox. Confirm the link and you are on the list.
        </p>
      ) : (
        <div className="flex flex-col gap-1.5 sm:w-80">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              startTransition(async () =>
                setResult(
                  await subscribeToNewsletterAction({
                    email,
                    organizationReference: honeypot,
                  }),
                ),
              );
            }}
            className={cn(
              "border-border bg-background/60 flex items-center rounded-full border p-1 pl-2",
              "transition-colors focus-within:border-foreground/30 w-full",
            )}
          >
            <input
              type="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="my@email.com"
              aria-label="Email address"
              aria-invalid={result?.status === "invalid" || undefined}
              className="text-foreground placeholder:text-muted-foreground h-7 min-w-0 flex-1 bg-transparent px-2.5 text-sm outline-none"
            />
            {/* Honeypot: off-screen, untabbable, unlabelled to a human. */}
            <input
              type="text"
              tabIndex={-1}
              autoComplete="off"
              aria-hidden="true"
              value={honeypot}
              onChange={(event) => setHoneypot(event.target.value)}
              className="pointer-events-none absolute left-[-9999px] h-0 w-0 opacity-0"
              placeholder="leave this empty"
            />
            <Button
              type="submit"
              size="sm"
              disabled={pending}
              className="shrink-0 rounded-full px-4"
            >
              {pending ? "Sending…" : "Subscribe"}
            </Button>
          </form>
          {message ? (
            <p role="alert" className="text-muted-foreground px-3 text-xs">
              {message}
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}
