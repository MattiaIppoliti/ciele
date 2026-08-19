"use client";

import React from "react";
import { Button, cn } from "@agent-hub/ui";

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

/* Newsletter sign-up. No backend yet, so it confirms locally, honest about
   being a demo without silently dropping the address on the floor. */
export function FooterNewsletter() {
  const [email, setEmail] = React.useState("");
  const [subscribed, setSubscribed] = React.useState(false);

  return (
    <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-center sm:gap-4 lg:w-auto">
      <p className="text-muted-foreground font-mono text-xs font-medium uppercase tracking-wider">
        Newsletter
      </p>
      {subscribed ? (
        <p className="text-foreground text-sm">Thanks, we&apos;ll be in touch.</p>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (email.trim()) setSubscribed(true);
          }}
          className={cn(
            "border-border bg-background/60 flex items-center rounded-full border p-1 pl-2",
            "transition-colors focus-within:border-foreground/30 sm:w-80",
          )}
        >
          <input
            type="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="my@email.com"
            aria-label="Email address"
            className="text-foreground placeholder:text-muted-foreground h-7 min-w-0 flex-1 bg-transparent px-2.5 text-sm outline-none"
          />
          <Button type="submit" size="sm" className="shrink-0 rounded-full px-4">
            Subscribe
          </Button>
        </form>
      )}
    </div>
  );
}
