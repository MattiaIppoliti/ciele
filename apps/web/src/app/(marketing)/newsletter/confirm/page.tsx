import type { Metadata } from "next";
import Link from "next/link";
import { verifyConfirmationToken } from "@/lib/marketing/newsletter";
import { ConfirmPanel } from "./confirm-panel";

export const metadata: Metadata = {
  title: "Confirm your subscription | Ciele",
  description: "Confirm the email address you signed up with.",
  // A one-shot page reachable only with a signed token; nothing to index and
  // nothing a crawler should be following.
  robots: { index: false, follow: false },
};

/**
 * The landing page of the confirmation link.
 *
 * It verifies the token to decide *what to render*, then hands the token to a
 * button that posts. The subscription happens on that POST, never on this GET:
 * mail scanners open every link in an inbound message, and a GET that
 * subscribed would let Defender opt people in for them.
 *
 * Reading `searchParams` makes this one page dynamic. The marketing layout
 * above it stays request-free, so the other seven pages keep prerendering.
 */
export default async function NewsletterConfirmPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const verified = verifyConfirmationToken(token);

  return (
    <main className="mx-auto flex min-h-[60vh] w-full max-w-xl flex-col justify-center gap-6 px-6 py-24">
      {verified.ok ? (
        <ConfirmPanel token={token as string} email={verified.email} />
      ) : (
        <div className="flex flex-col gap-3">
          <h1 className="text-foreground text-2xl font-medium">
            {verified.reason === "expired"
              ? "That link has expired"
              : verified.reason === "unconfigured"
                ? "We cannot check that link right now"
                : "That link is not valid"}
          </h1>
          <p className="text-muted-foreground text-sm">
            {verified.reason === "expired"
              ? "Confirmation links last 48 hours. Sign up again from the footer and we will send a fresh one."
              : verified.reason === "unconfigured"
                ? "Subscriptions are misconfigured on our side, so your link is fine but unusable. Try again later."
                : "The link was incomplete or altered in transit. Sign up again from the footer to get a new one."}
          </p>
          <Link
            href="/home"
            className="text-foreground text-sm font-medium underline underline-offset-4"
          >
            Back to the site
          </Link>
        </div>
      )}
    </main>
  );
}
