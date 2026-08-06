import { Clock, PhoneCall } from "lucide-react";
import { AuthGrid } from "@/components/auth/auth-grid";
import { GhostMark } from "@/components/auth/ghost-mark";
import { Link } from "@/components/ui/link";
import { ContactSalesForm } from "@/components/contact/contact-sales-form";

/**
 * The contact-sales page: a framed two-column card on the auth pages' dark
 * animated grid, rather than the marketing shell.
 *
 * A server component. All of it — the frame, the grid bands, the pitch column
 * and the two claims along the bottom — is static copy, so the only thing that
 * needs the browser is the form itself, in `ContactSalesForm`.
 */

/** Shared square-grid strip (the checker band above/below the content). */
function GridStrip() {
  return (
    <div
      aria-hidden="true"
      className="h-16 w-full"
      style={{
        backgroundImage:
          "linear-gradient(to right, rgba(255,255,255,0.08) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.08) 1px, transparent 1px)",
        backgroundSize: "64px 64px",
        // Start each strip at its frame edge. Centering a 64px pattern was
        // producing half-width cells at both sides of the perimeter.
        backgroundPosition: "left top",
      }}
    />
  );
}

export function ContactSales() {
  return (
    <div className="dark text-foreground relative h-full overflow-y-auto bg-[#080808]">
      {/* The animated grid belongs to the page surround only. The framed
          contact form remains quiet, with its square bands limited to top and bottom. */}
      <AuthGrid tone="dark" />
      <div className="relative z-10 mx-auto max-w-[66.125rem] px-4 py-8 md:py-12">
        <div className="border-border border bg-[#080808]">
          <GridStrip />

          <div className="border-border grid border-t border-b md:grid-cols-2">
            {/* Pitch column */}
            <div className="border-border flex flex-col md:border-r">
              <div className="p-8 md:p-10">
                <Link
                  href="/login"
                  aria-label="Go to Ciele sign in"
                  className="mb-6 inline-flex items-center gap-2.5 text-sm font-semibold hover:opacity-70"
                >
                  <GhostMark className="size-11" eyesClassName="ghost-eyes-glance" />
                  <span className="font-brand text-2xl font-medium">Ciele</span>
                </Link>
                <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">
                  Learn about Ciele
                </h1>

                <div className="mt-10 space-y-8">
                  <p className="text-muted-foreground leading-relaxed">
                    <PhoneCall className="text-foreground mr-2 inline size-4 -translate-y-px" />
                    <span className="text-foreground font-semibold">
                      Get a custom demo.
                    </span>{" "}
                    Discover the value of Ciele for your organization and explore
                    our custom plans and pricing.
                  </p>
                  <p className="text-muted-foreground leading-relaxed">
                    <Clock className="text-foreground mr-2 inline size-4 -translate-y-px" />
                    <span className="text-foreground font-semibold">
                      Set up your pilot.
                    </span>{" "}
                    See for yourself how Ciele&apos;s AI assistants speed up customer
                    support and lighten the load on your teams.
                  </p>
                </div>
              </div>

              <div className="border-border mt-auto grid grid-cols-2 border-t">
                <div className="border-border border-r p-8">
                  <p className="text-lg leading-snug">
                    <span className="font-semibold">Instant answers</span>{" "}
                    <span className="text-muted-foreground">
                      from your websites, docs and files.
                    </span>
                  </p>
                </div>
                <div className="p-8">
                  <p className="text-lg leading-snug">
                    <span className="font-semibold">24/7 support</span>{" "}
                    <span className="text-muted-foreground">
                      on every customer channel, with human escalation.
                    </span>
                  </p>
                </div>
              </div>
            </div>

            {/* Form column */}
            <div className="p-8 md:p-10">
              <ContactSalesForm />
            </div>
          </div>

          <GridStrip />
        </div>
      </div>
    </div>
  );
}
