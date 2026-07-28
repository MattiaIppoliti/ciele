# Stripe billing (managed edition)

How the published ladder connects to Stripe, and how to change it without the
product and the invoice disagreeing. Enterprise-only: everything here lives under
`apps/web/src/ee/billing`, which the public mirror never ships.

## The one rule

`PLAN_PRICE_EUR` in `apps/web/src/ee/billing/plans.ts` is the price. The pricing
page, the Billing page and the plan catalog all derive from it, and the Stripe
Prices exist to charge exactly it. A price is never written anywhere else — not
in a component, not in copy, not in metadata.

Allowances follow the same rule: `PLAN_LIMITS` derives each tier's included
credits from its price, and `readOrgPlanLimits` resolves what one organization
gets (plan allowance + staff overrides). There is no table to keep in step by
hand.

## Stripe setup

Three Products, named exactly as the tier slugs the code uses — **Go**,
**Business**, **Enterprise** — each with one recurring **monthly** Price in
**EUR**, at the amount in `PLAN_PRICE_EUR` (today €49 / €199 / €999).

There are no per-seat Prices. Members are unlimited on every plan; what a plan
meters is platform-funded AI work, so a subscription carries exactly one line
item at `quantity: 1`.

Then set, per environment:

| Variable | Value |
|---|---|
| `STRIPE_SECRET_KEY` | secret key for that environment |
| `STRIPE_WEBHOOK_SECRET` | signing secret of the endpoint below |
| `STRIPE_PRICE_GO` | Price id of the Go monthly Price |
| `STRIPE_PRICE_BUSINESS` | Price id of the Business monthly Price |
| `STRIPE_PRICE_ENTERPRISE` | Price id of the Enterprise monthly Price |

Enterprise is sales-led, so its Price is used by a Checkout link staff attach
rather than by a self-serve button.

## What the code does with them

- **`priceIdForPlan`** reads the env var. Absent → the catalog marks the tier
  `checkout: false` and every button leads to sales instead of a dead redirect.
- **`checkPlanPrice`** (`plan-prices.ts`) asks Stripe whether that Price is
  active, monthly, in EUR, and charging the published cents. It runs immediately
  before any Checkout redirect — both the public `/api/ee/stripe/checkout` route
  and the in-product `startUpgradeCheckout` — and **refuses the sale** on any
  mismatch, sending the buyer to sales and the reason to the logs. A configured
  Price id is not evidence that it charges what the page quoted; an archived,
  re-created or dashboard-edited Price is exactly how that drifts.
- **`resolvePlanFromPrice`** maps a webhook's Price id back to a tier, falling
  back to the cheapest rather than throwing, so a mispriced event never leaves an
  organization uncapped.

## Changing a price

1. Create the new Price in Stripe (Prices are immutable — you archive, you do not
   edit).
2. Update `PLAN_PRICE_EUR` in the same PR as the new Price id. The published
   volumes move with it, and `catalog.test.ts` pins them, so a change you did not
   intend fails the build.
3. Deploy, then load `/pricing` and click through to Checkout once. If the two
   sides disagree the click lands on `/contact/sales` and the log line names both
   amounts.

Existing subscribers keep the Price they subscribed on until they change plan;
Stripe does not re-price a live subscription.

## Webhook

Endpoint: `POST /api/ee/stripe/webhook`, signed with `STRIPE_WEBHOOK_SECRET`.
Events: `checkout.session.completed`, `customer.subscription.*`,
`invoice.payment_failed`. The transform (`webhook.ts`) is pure and unit-tested;
the store applies it with the service-role client. Members only ever read their
own organization's row (RLS).

## Cancelling and changing plan

Both are the hosted Customer Portal (`startBillingPortal`), never Checkout: a
subscription-mode Checkout session always creates a subscription, so running one
for an existing subscriber would bill them twice and orphan the first
subscription. `startUpgradeCheckout` refuses an organization that already has one,
independently of what the UI offered.

## Testing without charging anyone

Use the test-mode key and test Price ids. `pnpm dev` with `STRIPE_SECRET_KEY`
unset renders the pricing page with the catalog's prices and every button pointed
at sales, which is also exactly what an open-source deployment shows.
