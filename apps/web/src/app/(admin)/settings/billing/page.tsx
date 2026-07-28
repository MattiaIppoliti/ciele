import { redirect } from "next/navigation";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@agent-hub/ui";
import { requirePageMember } from "@/lib/authz";
import { canManageMembers } from "@/lib/rbac";
import { selfServeTiers } from "@/lib/plan-pricing";
import { getEnterpriseCapabilities } from "@agent-hub/agent";
import { usageLimitsView } from "@/lib/usage-meters";
import { ActivationStatusCard } from "@/components/settings/activation-status-card";
import { BillingAccountCard } from "@/components/settings/billing-account-card";
import { SettingsPanel } from "@/components/settings/settings-panel";
import {
  CheckoutNotice,
  PlanSummaryCard,
  PlanUpgradeCard,
  type CheckoutOutcome,
} from "@/components/settings/plan-card";

export const dynamic = "force-dynamic";

const CHECKOUT_OUTCOMES: readonly CheckoutOutcome[] = [
  "success",
  "cancelled",
  "error",
];

/** Anchor the pending card's "Choose a plan" button jumps to. */
const PLANS_ANCHOR = "plans";

const checkoutOutcome = (value: string | string[] | undefined) =>
  CHECKOUT_OUTCOMES.find((outcome) => outcome === value) ?? null;

/**
 * Billing, activation, and the plan ladder (#444 / #511).
 *
 * On a self-hosted deployment there is nothing to bill: the enterprise
 * capabilities are their OSS defaults, so the organization reads as active
 * with no subscription, there is no catalog, and this page says exactly that.
 * On the managed platform the same page carries the activation state, the
 * talk-to-us CTA while pending, the plan with its meters at a glance, and the
 * self-serve way up.
 */
export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { session, organizationId, role } = await requirePageMember();
  if (!canManageMembers(role)) redirect("/settings/profile");

  const capabilities = getEnterpriseCapabilities();
  const params = await searchParams;
  // Straight back from Checkout: write the subscription from the session before
  // reading anything, so a customer who lands ahead of the webhook is not told
  // their organization is still pending. Failures are swallowed on purpose — the
  // webhook is the source of record and will apply the same row moments later.
  const returnedSession = params.session_id;
  if (params.checkout === "success" && typeof returnedSession === "string") {
    try {
      await capabilities.billing.reconcileCheckout({
        organizationId: session.organization.id,
        sessionId: returnedSession,
      });
    } catch (error) {
      console.error("[billing] checkout reconciliation failed", error);
    }
  }
  const [activation, subscription, limits, account] = await Promise.all([
    capabilities.activation.getActivation(session.organization.id),
    capabilities.billing.getSubscription(session.organization.id),
    capabilities.metering.getUsageLimits(organizationId),
    // Live Stripe: renewal, card, invoices. A provider failure must not take the
    // whole tab down — everything else here comes from our own row, which is
    // still worth showing.
    capabilities.billing
      .getBillingAccount(session.organization.id)
      .catch((error) => {
        console.error("[billing] account lookup failed", error);
        return null;
      }),
  ]);
  const catalog = capabilities.billing.getPlanCatalog();
  // Whether the pending card offers a card field or a conversation: only a tier
  // Stripe can actually charge for counts (see `selfServeTiers`).
  const selfServe = selfServeTiers(catalog?.tiers ?? null).length > 0;
  const view = limits ? usageLimitsView(limits, new Date().toISOString()) : null;
  // An all-uncapped plan is not a capped state; the summary says so in words
  // rather than drawing three empty rings (same rule as the Usage page).
  const meters = view && !view.allUncapped ? view : null;
  const outcome = checkoutOutcome(params.checkout);

  return (
    <SettingsPanel
      title="Billing"
      description={`${session.organization.name}'s plan, payment method, and invoices.`}
    >
        {outcome ? <CheckoutNotice outcome={outcome} /> : null}

        <ActivationStatusCard
          activation={activation}
          subscription={subscription}
          selfServe={selfServe}
          plansAnchor={PLANS_ANCHOR}
        />

        {/* The plan and the ladder exist only where there is something to sell. */}
        {catalog ? (
          <>
            {subscription ? (
              <PlanSummaryCard
                plan={subscription.plan}
                comped={subscription.status === "comped"}
                paying={subscription.stripeManaged}
                catalog={catalog.tiers}
                limits={meters}
              />
            ) : null}
            {/* Shown while pending as well as while active: paying IS activation
                (ee/activation.ts derives one from the other), so for a pending
                organization this ladder is the way out of the pending state and
                hiding it would leave the console with no self-serve path at
                all. It renders nothing where no tier can be charged. */}
            <PlanUpgradeCard
              plan={subscription?.plan ?? null}
              paying={subscription?.stripeManaged ?? false}
              catalog={catalog.tiers}
              pending={activation.state === "pending"}
              id={PLANS_ANCHOR}
            />
          </>
        ) : null}

        {/* What Stripe knows, for an organization that actually pays. */}
        {account ? <BillingAccountCard account={account} /> : null}

        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Your data is yours</CardTitle>
            <CardDescription>
              Whatever happens to a plan, nothing you have configured is
              deleted.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-muted-foreground space-y-2 text-sm">
            <p>
              Assistants, knowledge, flows and conversation history stay exactly
              as they are while an organization is pending, paused, or between
              plans. Activating restores answering; nothing has to be rebuilt.
            </p>
            <p>
              You can also run Ciele yourself, free and forever, on the same
              open-source core —{" "}
              <a
                className="underline underline-offset-4"
                href="https://ciele.app/docs/self-hosting"
              >
                self-hosting documentation
              </a>
              .
            </p>
          </CardContent>
        </Card>
    </SettingsPanel>
  );
}
