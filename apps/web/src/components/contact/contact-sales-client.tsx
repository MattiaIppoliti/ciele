"use client";

import { ChevronLeft, Clock, PhoneCall } from "lucide-react";
import { useId, useState, useTransition } from "react";
import {
  submitSalesEnquiryAction,
  type ContactSalesResult,
} from "@/app/contact/sales/actions";
import {
  SALES_COMPANY_SIZES,
  SALES_COUNTRIES,
  SALES_LEAD_LIMITS,
  SALES_PRODUCT_INTERESTS,
  type SalesLeadErrors,
} from "@/lib/contact/sales-lead";
import { AuthGrid } from "@/components/auth/auth-grid";
import { GhostMark } from "@/components/auth/ghost-mark";
import { Button } from "@agent-hub/ui";
import { Input } from "@agent-hub/ui";
import { Label } from "@agent-hub/ui";
import { Link } from "@/components/ui/link";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

// The option vocabulary lives in lib/contact/sales-lead.ts because the Server
// Action validates against the same lists — a <Select> constrains a browser,
// never a poster.
const COUNTRIES = SALES_COUNTRIES;
const COMPANY_SIZES = SALES_COMPANY_SIZES;
const PRODUCT_INTERESTS = SALES_PRODUCT_INTERESTS;

/** Inline field error, rendered under the input it belongs to. */
function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="text-destructive text-xs">
      {message}
    </p>
  );
}

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

export function ContactSalesClient() {
  const honeypotId = useId();
  const [consent, setConsent] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [country, setCountry] = useState<string>("Italy");
  const [size, setSize] = useState("");
  const [interest, setInterest] = useState("");
  const [errors, setErrors] = useState<SalesLeadErrors>({});
  /** Non-field failure (delivery or rate limit) shown above the button. */
  const [problem, setProblem] = useState<ContactSalesResult | null>(null);
  const [pending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const field = (name: string) => String(data.get(name) ?? "");
    setErrors({});
    setProblem(null);
    startTransition(async () => {
      // The thank-you panel is now conditional on the server saying the
      // enquiry actually left the building.
      const result = await submitSalesEnquiryAction({
        email: field("email"),
        name: field("name"),
        phone: field("phone"),
        website: field("website"),
        message: field("message"),
        country,
        size,
        interest,
        consent,
        organizationReference: field("organizationReference"),
      }).catch((): ContactSalesResult => ({ status: "unavailable" }));

      if (result.status === "sent") {
        setSubmitted(true);
        return;
      }
      if (result.status === "invalid") {
        setErrors(result.errors);
        return;
      }
      setProblem(result);
    });
  }

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
              {submitted ? (
                <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
                  <h2 className="text-2xl font-semibold">Thank you!</h2>
                  <p className="text-muted-foreground max-w-sm text-sm">
                    Your request has been received, the Ciele team will get
                    back to you shortly.
                  </p>
                  <Link
                    href="/login"
                    className="text-primary mt-2 flex items-center gap-1 text-sm font-medium hover:underline"
                  >
                    <ChevronLeft className="size-4" strokeWidth={3} />
                    Back to sign in
                  </Link>
                </div>
              ) : (
                <form onSubmit={handleSubmit} noValidate className="space-y-5">
                  {/* Honeypot. Off-screen rather than display:none so a bot
                      that skips hidden fields still sees it; never focusable,
                      never announced, never autofilled. */}
                  <div aria-hidden="true" className="sr-only">
                    <label htmlFor={honeypotId}>
                      Organization reference — leave this field empty
                    </label>
                    <input
                      id={honeypotId}
                      name="organizationReference"
                      type="text"
                      tabIndex={-1}
                      autoComplete="off"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="email">Institution email</Label>
                    <Input
                      id="email"
                      name="email"
                      type="email"
                      placeholder="Email address"
                      autoComplete="email"
                      maxLength={SALES_LEAD_LIMITS.email}
                      aria-invalid={Boolean(errors.email)}
                      aria-describedby={errors.email ? "email-error" : undefined}
                      required
                    />
                    <FieldError id="email-error" message={errors.email} />
                  </div>

                  <div className="grid gap-5 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="name">Your name</Label>
                      <Input
                        id="name"
                        name="name"
                        placeholder="Full name"
                        autoComplete="name"
                        maxLength={SALES_LEAD_LIMITS.name}
                        aria-invalid={Boolean(errors.name)}
                        aria-describedby={errors.name ? "name-error" : undefined}
                        required
                      />
                      <FieldError id="name-error" message={errors.name} />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="phone">
                        Phone number{" "}
                        <span className="text-muted-foreground font-normal">(Optional)</span>
                      </Label>
                      <Input
                        id="phone"
                        name="phone"
                        type="tel"
                        placeholder="Enter phone number"
                        autoComplete="tel"
                        maxLength={SALES_LEAD_LIMITS.phone}
                        aria-invalid={Boolean(errors.phone)}
                        aria-describedby={errors.phone ? "phone-error" : undefined}
                      />
                      <FieldError id="phone-error" message={errors.phone} />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label>Country</Label>
                    <Select value={country} onValueChange={(v) => setCountry(v as string)}>
                      <SelectTrigger className="w-full">
                        <SelectValue>{() => country}</SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {COUNTRIES.map((c) => (
                          <SelectItem key={c} value={c}>
                            {c}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="grid gap-5 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="website">Institution website</Label>
                      <Input
                        id="website"
                        name="website"
                        placeholder="http://address.com"
                        maxLength={SALES_LEAD_LIMITS.website}
                        aria-invalid={Boolean(errors.website)}
                        aria-describedby={errors.website ? "website-error" : undefined}
                      />
                      <FieldError id="website-error" message={errors.website} />
                    </div>
                    <div className="space-y-2">
                      <Label>Institution size</Label>
                      <Select value={size} onValueChange={(v) => setSize(v as string)}>
                        <SelectTrigger className="w-full">
                          <SelectValue>
                            {() =>
                              size || (
                                <span className="text-muted-foreground">Select a value</span>
                              )
                            }
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {COMPANY_SIZES.map((s) => (
                            <SelectItem key={s} value={s}>
                              {s}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label>Primary product interest</Label>
                    <Select value={interest} onValueChange={(v) => setInterest(v as string)}>
                      <SelectTrigger className="w-full">
                        <SelectValue>
                          {() =>
                            interest || (
                              <span className="text-muted-foreground">Select a value</span>
                            )
                          }
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {PRODUCT_INTERESTS.map((p) => (
                          <SelectItem key={p} value={p}>
                            {p}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="message">How can we help?</Label>
                    <Textarea
                      id="message"
                      name="message"
                      placeholder="Your organization's needs"
                      rows={5}
                      maxLength={SALES_LEAD_LIMITS.message}
                      aria-invalid={Boolean(errors.message)}
                      aria-describedby={errors.message ? "message-error" : undefined}
                    />
                    <FieldError id="message-error" message={errors.message} />
                  </div>

                  <div className="border-border flex items-start justify-between gap-4 rounded-lg border p-4">
                    <div>
                      <p className="text-sm font-semibold">Privacy Policy</p>
                      <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
                        Yes, I agree to receive communications from Ciele. I can
                        withdraw my consent at any time.
                      </p>
                    </div>
                    <Switch
                      checked={consent}
                      onCheckedChange={setConsent}
                      aria-label="Privacy Policy consent"
                    />
                  </div>
                  <FieldError id="consent-error" message={errors.consent} />

                  {problem ? (
                    <p
                      role="alert"
                      className="border-destructive/40 bg-destructive/10 text-foreground rounded-lg border p-3 text-xs leading-relaxed"
                    >
                      {problem.status === "rate_limited" ? (
                        <>
                          You&apos;ve sent us several enquiries just now. Please try
                          again in{" "}
                          {Math.max(1, Math.ceil(problem.retryAfterSeconds / 60))} minutes.
                        </>
                      ) : (
                        <>
                          We couldn&apos;t send your request — nothing has reached
                          us. Please email{" "}
                          <a
                            href="mailto:sales@ciele.app"
                            className="font-medium underline underline-offset-4"
                          >
                            sales@ciele.app
                          </a>{" "}
                          and we&apos;ll pick it up from there.
                        </>
                      )}
                    </p>
                  ) : null}

                  <Button
                    type="submit"
                    className="w-full"
                    disabled={!consent || pending}
                  >
                    {pending ? "Sending…" : "Talk to Ciele"}
                  </Button>
                </form>
              )}
            </div>
          </div>

          <GridStrip />
        </div>
      </div>
    </div>
  );
}
