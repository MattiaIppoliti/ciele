"use server";

import { redirect } from "next/navigation";
import { requireMember } from "@/lib/authz";
import { getEnterpriseCapabilities } from "@/lib/runtime";

/**
 * Open Stripe's Customer Portal — where an existing subscriber changes tier,
 * updates a card or cancels (#511). Falls back to the conversation when there is
 * no Stripe customer to open it for, and to this page with a notice when Stripe
 * itself fails.
 */
export async function openBillingPortalAction(): Promise<void> {
  const { organizationId } = await requireMember("manageMembers");

  let url: string | null = null;
  try {
    url =
      await getEnterpriseCapabilities().billing.startBillingPortal(organizationId);
  } catch (error) {
    console.error("[billing] portal session failed", error);
    redirect("/settings/billing?checkout=error");
  }

  if (!url) redirect("/contact/sales");
  redirect(url);
}

/**
 * Start hosted checkout for a self-serve tier (#511).
 *
 * The whole action is a redirect: to Stripe when a session could be created, and
 * to the contact path when this deployment cannot sell that tier (open source, an
 * unconfigured Price, a sales-led tier). Never a thrown error the admin has to
 * interpret — a failed Stripe call lands back on this page with a notice, because
 * "we could not start checkout, here is a human" beats an error boundary.
 *
 * `manageMembers` is the same capability that gates the billing page itself.
 */
export async function startPlanCheckoutAction(formData: FormData): Promise<void> {
  const { session, organizationId } = await requireMember("manageMembers");
  const plan = String(formData.get("plan") ?? "");

  let url: string | null = null;
  try {
    url = await getEnterpriseCapabilities().billing.startUpgradeCheckout({
      organizationId,
      plan,
      customerEmail: session.email || null,
    });
  } catch (error) {
    // Nothing in the capability redirects, so anything thrown here is a real
    // Stripe or network failure.
    console.error("[billing] checkout session failed", error);
    redirect("/settings/billing?checkout=error");
  }

  // Nothing to sell for this tier: the conversation is the upgrade path.
  if (!url) redirect("/contact/sales");
  redirect(url);
}
