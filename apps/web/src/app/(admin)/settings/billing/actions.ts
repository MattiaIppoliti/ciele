"use server";

import { redirect } from "next/navigation";
import { requireMember } from "@/lib/authz";
import { getEnterpriseCapabilities } from "@agent-hub/agent";

/**
 * The shared shape of the three billing actions: the whole action is a
 * redirect. To Stripe when `start` returns a URL, to the conversation when it
 * returns none (nothing to sell), and back to the billing page with a notice
 * when it throws. Nothing in the capability redirects, so anything thrown
 * inside the `try` is a real Stripe or network failure; both `redirect` calls
 * stay out of its reach, since `redirect` itself works by throwing.
 */
async function redirectTo(
  label: string,
  start: () => Promise<string | null | undefined>,
): Promise<never> {
  let url: string | null | undefined = null;
  try {
    url = await start();
  } catch (error) {
    console.error(`[billing] ${label} failed`, error);
    redirect("/settings/billing?checkout=error");
  }
  redirect(url || "/contact/sales");
}

/**
 * Open Stripe's Customer Portal: where an existing subscriber changes tier,
 * updates a card or cancels (#511). Falls back to the conversation when there is
 * no Stripe customer to open it for, and to this page with a notice when Stripe
 * itself fails.
 */
export async function openBillingPortalAction(): Promise<void> {
  const { organizationId } = await requireMember("manageMembers");
  await redirectTo("portal session", () =>
    getEnterpriseCapabilities().billing.startBillingPortal(organizationId),
  );
}

/**
 * Start hosted checkout for a self-serve tier (#511).
 *
 * The contact path is for a deployment that cannot sell that tier (open source,
 * an unconfigured Price, a sales-led tier). Never a thrown error the admin has
 * to interpret, a failed Stripe call lands back on this page with a notice,
 * because "we could not start checkout, here is a human" beats an error
 * boundary.
 *
 * `manageMembers` is the same capability that gates the billing page itself.
 */
export async function startPlanCheckoutAction(formData: FormData): Promise<void> {
  const { session, organizationId } = await requireMember("manageMembers");
  const plan = String(formData.get("plan") ?? "");
  await redirectTo("checkout session", () =>
    getEnterpriseCapabilities().billing.startUpgradeCheckout({
      organizationId,
      plan,
      customerEmail: session.email || null,
    }),
  );
}

/**
 * Buy a credit pack (#852). Same shape and same failure handling as the plan
 * checkout above: a configuration case (no Stripe Price for this pack, no plan
 * to buffer, or an open-source deployment) sends the buyer to a human, and only
 * a real Stripe or network failure lands on the error notice.
 */
export async function startTopupCheckoutAction(formData: FormData): Promise<void> {
  const { session, organizationId } = await requireMember("manageMembers");
  const pack = String(formData.get("pack") ?? "");
  await redirectTo("topup checkout session", async () =>
    getEnterpriseCapabilities().billing.startTopupCheckout?.({
      organizationId,
      pack,
      customerEmail: session.email || null,
    }),
  );
}
