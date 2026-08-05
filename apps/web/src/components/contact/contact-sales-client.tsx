"use client";

import { ChevronLeft, Clock, PhoneCall } from "lucide-react";
import { useState } from "react";
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

const COUNTRIES = [
  "Italy",
  "United Kingdom",
  "United States",
  "France",
  "Germany",
  "Spain",
  "Netherlands",
  "Switzerland",
  "Other",
];

const COMPANY_SIZES = ["1 to 500", "501 to 2,000", "2,001 to 10,000", "10,001 to 30,000", "30,000+"];

const PRODUCT_INTERESTS = [
  "Customer support assistants",
  "Internal knowledge assistants",
  "Help desk & escalation",
  "Knowledge & content ingestion",
  "Analytics & insights",
  "Other",
];

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
  const [consent, setConsent] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [country, setCountry] = useState("Italy");
  const [size, setSize] = useState("");
  const [interest, setInterest] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitted(true);
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
                <form onSubmit={handleSubmit} className="space-y-5">
                  <div className="space-y-2">
                    <Label htmlFor="email">Institution email</Label>
                    <Input
                      id="email"
                      type="email"
                      placeholder="Email address"
                      autoComplete="email"
                      required
                    />
                  </div>

                  <div className="grid gap-5 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="name">Your name</Label>
                      <Input id="name" placeholder="Full name" autoComplete="name" required />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="phone">
                        Phone number{" "}
                        <span className="text-muted-foreground font-normal">(Optional)</span>
                      </Label>
                      <Input id="phone" type="tel" placeholder="Enter phone number" autoComplete="tel" />
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
                      <Input id="website" placeholder="http://address.com" />
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
                      placeholder="Your organization's needs"
                      rows={5}
                    />
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

                  <Button type="submit" className="w-full" disabled={!consent}>
                    Talk to Ciele
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
