import { RadialGauge } from "@agent-hub/charts";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@agent-hub/ui";
import { Link } from "@/components/ui/link";
import { cn } from "@/lib/utils";
import type { PlanCatalogEntry } from "@/lib/runtime";
import {
  planDisplayName as titleCase,
  planTierViews,
  upgradeOptions,
  type PlanTierView,
} from "@/lib/plan-pricing";
import {
  TONE_STROKE,
  TONE_TEXT,
  planGlanceRows,
  type MeterGlanceRow,
  type UsageLimitsView,
} from "@/lib/usage-meters";
import {
  openBillingPortalAction,
  startPlanCheckoutAction,
} from "@/app/(admin)/settings/billing/actions";

/**
 * The plan, its meters, and the way up — on Billing (#511).
 *
 * Deliberately a summary rather than a second Usage page: one ring per metered
 * resource showing the window closest to its cap, computed by the same
 * `usage-meters` module the Usage page draws from, so the two can never tell
 * different stories. The full breakdown is one link away.
 *
 * Every state this renders honestly:
 *   - no catalog (open source)      → nothing here renders at all
 *   - comped / pending              → the price line says so instead of charging
 *   - a tier the catalog forgot     → plan named, price omitted, whole ladder offered
 *   - Stripe unconfigured           → the tier's CTA is the conversation
 */

function TierPrice({ tier }: { tier: PlanTierView }) {
  return (
    <span>
      {tier.pricePrefix ? (
        <span className="text-muted-foreground text-sm">
          {tier.pricePrefix}{" "}
        </span>
      ) : null}
      <span className="font-medium">{tier.priceLabel}</span>
      <span className="text-muted-foreground"> / month</span>
    </span>
  );
}

/** One metered resource as a small ring plus its numbers. */
function GlanceMeter({ row }: { row: MeterGlanceRow }) {
  return (
    <div className="flex items-center gap-3">
      <RadialGauge
        size={56}
        strokeWidth={5}
        gap={2}
        rings={[
          {
            fraction: row.fraction,
            toneClass: TONE_STROKE[row.tone],
            label: `${row.title}, ${row.windowLabel.toLowerCase()}: ${row.percentLabel} used`,
          },
        ]}
      >
        <span
          className={cn("text-xs font-semibold tabular-nums", TONE_TEXT[row.tone])}
        >
          {row.percentLabel}
        </span>
      </RadialGauge>
      <div className="text-sm">
        <p className="font-medium">{row.title}</p>
        <p className="text-muted-foreground text-xs">{row.detail}</p>
        <p className="text-muted-foreground text-xs">{row.windowLabel}</p>
      </div>
    </div>
  );
}

/**
 * The plan an organization is on, with its meters at a glance. Renders only when
 * there is a catalog to price against — a self-hosted deployment has no plan and
 * sees nothing.
 */
export function PlanSummaryCard({
  plan,
  comped,
  paying,
  catalog,
  limits,
}: {
  /** The stored plan slug from the subscription. */
  plan: string;
  /** An evaluation grant: the full experience, but nothing is being charged. */
  comped: boolean;
  /** A live Stripe subscription backs this plan. */
  paying: boolean;
  catalog: PlanCatalogEntry[];
  /** The plan's meters, or null when this organization is not capped. */
  limits: UsageLimitsView | null;
}) {
  const tier = planTierViews(catalog).find((entry) => entry.slug === plan) ?? null;
  const rows = limits ? planGlanceRows(limits) : [];
  const name = tier ? tier.name : titleCase(plan);

  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle>{name} plan</CardTitle>
        <CardDescription>
          {comped ? (
            <>
              An evaluation grant with {name}-sized limits — nothing is being
              charged yet.
            </>
          ) : /* A sales-led tier's published price is a floor, not what this
                organization pays, so their own billing page must not print it
                as if it were their invoice. */
          tier && !tier.salesLed ? (
            <>
              <TierPrice tier={tier} />, with the allowance below included.
            </>
          ) : paying ? (
            <>Priced with us, with the allowance below included.</>
          ) : (
            <>What this organization is entitled to.</>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {rows.length > 0 ? (
          <>
            <div className="grid gap-4 sm:grid-cols-3">
              {rows.map((row) => (
                <GlanceMeter key={row.resource} row={row} />
              ))}
            </div>
            <p className="text-muted-foreground text-sm">
              Each ring shows whichever window is closest to its cap — the one
              that would pause this kind of work next.{" "}
              <Link
                href="/settings/usage"
                className="text-foreground font-medium underline underline-offset-4"
              >
                Full usage breakdown
              </Link>
              .
            </p>
          </>
        ) : (
          <p className="text-muted-foreground text-sm">
            This organization is running without caps, so there is nothing to
            meter here.{" "}
            <Link
              href="/settings/usage"
              className="text-foreground font-medium underline underline-offset-4"
            >
              Usage is still recorded
            </Link>
            .
          </p>
        )}
        <p className="text-muted-foreground text-sm">
          Work on your own model keys is never counted against a plan allowance
          and never blocked by one.
        </p>
      </CardContent>
    </Card>
  );
}

/**
 * Where the plan can go, and how it gets there.
 *
 * The route depends on whether a Stripe subscription already exists, and that is
 * not a UI preference — hosted Checkout in subscription mode always CREATES a
 * subscription, so offering it to an existing subscriber would bill them twice.
 *
 *   already paying  → the Customer Portal, which is where Stripe does tier
 *                     changes, card updates and cancellation. The tiers are
 *                     listed as information, with no buttons that could
 *                     double-charge.
 *   not yet paying  → hosted Checkout per tier, including the tier a comped
 *                     evaluation is currently on, because that is the single most
 *                     likely thing they want to buy.
 *
 * A sales-led tier, or any tier this deployment cannot charge for, links to the
 * conversation instead — so no button here can fail.
 */
export function PlanUpgradeCard({
  plan,
  paying,
  catalog,
}: {
  plan: string | null;
  /** A live Stripe subscription backs the current plan. */
  paying: boolean;
  catalog: PlanCatalogEntry[];
}) {
  const options = upgradeOptions(plan, catalog, { paying });
  if (options.length === 0 && !paying) return null;

  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle>{paying ? "Change your plan" : "Room to grow"}</CardTitle>
        <CardDescription>
          {paying
            ? "Moving up raises every allowance at once. Tier changes, card details and cancellation all happen in Stripe’s billing portal."
            : "Moving up raises every allowance at once, from the next billing period you start."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {options.map((tier) => (
          <div
            key={tier.slug}
            className="border-border flex flex-wrap items-start justify-between gap-4 rounded-lg border p-4"
          >
            <div className="text-sm">
              {/* No `capitalize` here: the tier name arrives capitalized, and
                  the class would also title-case "/ month". */}
              <p className="font-medium">
                {tier.name} — <TierPrice tier={tier} />
              </p>
              <ul className="text-muted-foreground mt-2 space-y-1 text-xs">
                {tier.volumes.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
            {/* Nothing per-tier while paying: the portal is the only safe way to
                switch, and it is where the customer picks the new tier. */}
            {paying ? null : tier.cta === "checkout" ? (
              <form action={startPlanCheckoutAction}>
                <input type="hidden" name="plan" value={tier.slug} />
                <Button type="submit">
                  {tier.slug === plan
                    ? `Subscribe to ${tier.name}`
                    : `Move to ${tier.name}`}
                </Button>
              </form>
            ) : (
              <Button variant="outline" render={<Link href="/contact/sales" />}>
                Talk about {tier.name}
              </Button>
            )}
          </div>
        ))}
        {paying ? (
          <form action={openBillingPortalAction}>
            <Button type="submit">Manage plan and billing</Button>
          </form>
        ) : null}
      </CardContent>
    </Card>
  );
}

/** What Stripe sent the admin back with. */
export type CheckoutOutcome = "success" | "cancelled" | "error";

/**
 * The one line an admin needs after a round trip to Stripe. Success is
 * deliberately hedged: the subscription arrives by webhook, which may land a
 * moment after the redirect, so this promises a refresh rather than a plan.
 */
export function CheckoutNotice({ outcome }: { outcome: CheckoutOutcome }) {
  const copy: Record<CheckoutOutcome, string> = {
    success:
      "Payment received — thank you. Your new plan appears here as soon as Stripe confirms it, usually within a few seconds.",
    cancelled: "Checkout cancelled. Nothing was charged and your plan is unchanged.",
    error:
      "We could not start checkout. Nothing was charged — try again, or talk to us and we will set it up with you.",
  };
  const tone =
    outcome === "error"
      ? "border-amber-500/40"
      : outcome === "success"
        ? "border-emerald-500/40"
        : "";
  return (
    <Card className={cn("mt-6", tone)}>
      <CardContent className="text-sm">{copy[outcome]}</CardContent>
    </Card>
  );
}
