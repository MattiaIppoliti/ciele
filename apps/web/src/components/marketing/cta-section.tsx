import Link from "next/link";
import { Button } from "@agent-hub/ui";

/* How every marketing page signs off: one line, set as large as the page will
   allow, fading out towards its foot, with the two things a reader can do
   underneath. Deliberately the biggest type on the page, so the end of the
   scroll is an invitation rather than a stub of a card. */

interface Action {
  label: string;
  href: string;
}

export function CtaSection({
  lead,
  trail,
  primary,
  secondary,
}: {
  /** First line, at full strength. */
  lead: string;
  /** Second line. This is the one that fades. */
  trail: string;
  primary: Action;
  secondary?: Action;
}) {
  return (
    /* Padding above only: this is the last thing on the page, and the footer
       brings its own breathing room. */
    <section className="px-4 pb-4 pt-24 text-center sm:pt-32">
      <h2 className="mx-auto max-w-4xl text-4xl font-semibold tracking-tight sm:text-6xl">
        <span className="text-foreground block">{lead}</span>
        {/* The fade is in the type itself: the second line washes out into the
            page, so the section ends without a rule or an edge to stop on. */}
        <span className="from-foreground to-foreground/25 block bg-gradient-to-b bg-clip-text text-transparent">
          {trail}
        </span>
      </h2>

      {/* The hero's pair of buttons, not a second set: same component, same
          sizes, same ringed frame around the primary. */}
      <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
        <div className="bg-foreground/10 rounded-[calc(var(--radius-xl)+0.125rem)] border p-0.5">
          <Button
            size="lg"
            className="rounded-xl px-5 text-base"
            nativeButton={false}
            render={<Link href={primary.href} />}
          >
            <span className="text-nowrap">{primary.label}</span>
          </Button>
        </div>
        {secondary && (
          <Button
            size="lg"
            variant="ghost"
            className="rounded-xl px-5 text-base"
            nativeButton={false}
            render={<Link href={secondary.href} />}
          >
            <span className="text-nowrap">{secondary.label}</span>
          </Button>
        )}
      </div>
    </section>
  );
}
