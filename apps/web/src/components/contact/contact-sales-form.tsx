"use client";

import { ChevronLeft } from "lucide-react";
import { useId, useState, useTransition } from "react";
import { Button, Input, Label } from "@agent-hub/ui";
import {
  submitSalesEnquiryAction,
  type ContactSalesResult,
} from "@/app/(marketing)/contact/sales/actions";
import {
  SALES_COMPANY_SIZES,
  SALES_COUNTRIES,
  SALES_LEAD_LIMITS,
  SALES_PRODUCT_INTERESTS,
  type SalesLeadErrors,
} from "@/lib/contact/sales-lead";
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

/**
 * The contact form, and the only interactive part of the page: the field state,
 * the consent gate on the submit button, and the swap to the thank-you panel.
 * Everything around it — the frame, the grid bands and the pitch column — is
 * static and stays on the server (see `contact-sales.tsx`).
 *
 * Submitting calls the `submitSalesEnquiryAction` Server Action, which mails the
 * enquiry to the sales alias. The thank-you panel is conditional on the server
 * saying it left the building: `invalid` comes back as per-field errors, and a
 * rate limit or a failed delivery says so instead of claiming receipt.
 */

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

export function ContactSalesForm() {
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

  if (submitted) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
        <h2 className="text-2xl font-semibold">Thank you!</h2>
        <p className="text-muted-foreground max-w-sm text-sm">
          Your request has been received, the Ciele team will get back to you
          shortly.
        </p>
        <Link
          href="/login"
          className="text-primary mt-2 flex items-center gap-1 text-sm font-medium hover:underline"
        >
          <ChevronLeft className="size-4" strokeWidth={3} />
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-5">
      {/* Honeypot. Off-screen rather than display:none so a bot that skips
          hidden fields still sees it; never focusable, never announced, never
          autofilled. */}
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
            Yes, I agree to receive communications from Ciele. I can withdraw my
            consent at any time.
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
              You&apos;ve sent us several enquiries just now. Please try again in{" "}
              {Math.max(1, Math.ceil(problem.retryAfterSeconds / 60))} minutes.
            </>
          ) : (
            <>
              We couldn&apos;t send your request — nothing has reached us. Please
              email{" "}
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

      <Button type="submit" className="w-full" disabled={!consent || pending}>
        {pending ? "Sending…" : "Talk to Ciele"}
      </Button>
    </form>
  );
}
