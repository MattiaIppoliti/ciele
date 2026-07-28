import { CircleCheck, Clock } from "lucide-react";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@agent-hub/ui";
import { Link } from "@/components/ui/link";
import type { ActivationState, SubscriptionState } from "@agent-hub/agent";

/**
 * What state this organization is in, and the one action that moves it
 * forward (#444).
 *
 * Three shapes, in the order an organization meets them:
 *   pending  → pay for a plan (or talk to us where nothing is sellable)
 *   comped   → active on an evaluation grant; checkout when staff set a plan
 *   paid     → the plan, and where to manage it
 *
 * The pending action is **self-serve wherever it can be**: paying is what
 * activation is derived from (`ee/activation.ts` — an `active` subscription IS an
 * active organization), so a card is the shortest path from this card to a
 * working assistant, and sales is the fallback rather than the gate. Where
 * nothing can be charged — the open-source edition, or a managed deployment with
 * no Stripe Price configured — the conversation is the only honest CTA, so the
 * caller passes `selfServe: false` and this card says so instead of offering a
 * button that lands on a contact form.
 *
 * A self-hosted deployment always renders the "active, no subscription" case,
 * because its enterprise capabilities are the OSS defaults.
 */
export function ActivationStatusCard({
  activation,
  subscription,
  selfServe = false,
  plansAnchor = "plans",
}: {
  activation: ActivationState;
  subscription: SubscriptionState | null;
  /** At least one tier can be paid for right now (see `selfServeTiers`). */
  selfServe?: boolean;
  /** Element id of the plan ladder rendered below, for the pending CTA. */
  plansAnchor?: string;
}) {
  if (activation.state === "pending") {
    return (
      <Card className="mt-6 border-amber-500/40">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="size-4 text-amber-500" />
            Pending activation
          </CardTitle>
          <CardDescription>
            {selfServe ? (
              <>
                Your assistants do not answer yet. Everything else is open —
                pick a plan and they start answering as soon as the payment
                clears.
              </>
            ) : (
              <>
                Your assistants do not answer yet. Everything else is open —
                build them now and they start working the moment we activate
                you.
              </>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-muted-foreground text-sm">
            {selfServe
              ? "Pay by card and your organization activates itself: model credentials are included, so there is nothing to configure afterwards. Each plan below states the answering, crawling and indexing it funds every month."
              : "Ciele Cloud is sales-led: we set up your organization with model credentials included, so there is nothing for you to configure. Tell us what you are building and we will get you running."}
          </p>
          <div className="flex flex-wrap items-center gap-3">
            {selfServe ? (
              <>
                <Button render={<a href={`#${plansAnchor}`} />}>
                  Choose a plan
                </Button>
                <Button variant="outline" render={<Link href="/contact/sales" />}>
                  Or talk to us
                </Button>
              </>
            ) : (
              <>
                <Button render={<Link href="/contact/sales" />}>
                  Talk to us
                </Button>
                <Button
                  variant="outline"
                  render={<a href="https://ciele.app/docs/self-hosting" />}
                >
                  Or self-host it free
                </Button>
              </>
            )}
          </div>
          <p className="text-muted-foreground text-xs">
            Prefer to run it yourself? The open-source edition is the same
            product, free forever, and you can move your work to it or from it
            at any time.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (!subscription) {
    return (
      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CircleCheck className="size-4 text-emerald-500" />
            Active
          </CardTitle>
          <CardDescription>
            This organization is running with no managed subscription — the
            usual state for a self-hosted deployment.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-muted-foreground text-sm">
          You provide the infrastructure and the model credentials, and there is
          nothing to pay. If you would rather we ran it,{" "}
          <Link className="underline underline-offset-4" href="/contact/sales">
            talk to us
          </Link>
          .
        </CardContent>
      </Card>
    );
  }

  const comped = subscription.status === "comped";
  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CircleCheck className="size-4 text-emerald-500" />
          {comped ? "Active — evaluation" : "Active"}
        </CardTitle>
        <CardDescription>
          {comped ? (
            "You are on an evaluation grant with the full managed experience and evaluation-sized limits."
          ) : (
            // The plan is a slug, printed verbatim on purpose (#511) — but
            // capitalized in a sentence, so it does not read as a typo.
            <>
              You are on the{" "}
              <span className="capitalize">{subscription.plan}</span> plan.
            </>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <dl className="grid grid-cols-2 gap-3 text-sm sm:max-w-md">
          <dt className="text-muted-foreground">Plan</dt>
          <dd className="font-medium capitalize">{subscription.plan}</dd>
          <dt className="text-muted-foreground">Status</dt>
          <dd className="font-medium capitalize">
            {subscription.status.replace(/_/g, " ")}
          </dd>
        </dl>
        {subscription.status === "past_due" && (
          <p className="text-sm text-amber-600 dark:text-amber-400">
            A payment did not go through. Your assistants keep answering while
            we retry — update your card from the billing portal to avoid an
            interruption.
          </p>
        )}
        <div className="flex flex-wrap items-center gap-3">
          {/* Conversion (#444): staff attach a hosted Checkout link once they
              and the customer have agreed a plan. Paying retires the comped
              grant through the billing webhook — nothing to do here. */}
          {subscription.checkoutUrl && (
            <Button render={<a href={subscription.checkoutUrl} />}>
              Complete your subscription
            </Button>
          )}
          <Button
            variant={subscription.checkoutUrl ? "outline" : comped ? "default" : "outline"}
            render={<Link href="/contact/sales" />}
          >
            {comped ? "Talk about a plan" : "Contact us"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
