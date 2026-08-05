import { Clock } from "lucide-react";
import { Link } from "@/components/ui/link";
import { getEnterpriseCapabilities } from "@agent-hub/agent";
import { selfServeTiers } from "@/lib/plan-pricing";

/**
 * The pending-activation state, shown on every console page (#444).
 *
 * A fresh managed signup can configure everything but its assistants do not
 * answer yet, and that is not obvious from a console that otherwise works — so
 * it is said once, everywhere, with the action that resolves it.
 *
 * Renders nothing at all on a self-hosted deployment: the OSS activation
 * default is unconditionally active, so this component is inert there.
 */
export async function PendingActivationBanner({
  organizationId,
}: {
  organizationId: string;
}) {
  let pending = false;
  let selfServe = false;
  try {
    const capabilities = getEnterpriseCapabilities();
    const activation = await capabilities.activation.getActivation(organizationId);
    pending = activation.state === "pending";
    // Where a plan can actually be bought, paying is the fastest way out of this
    // state — activation is derived from the billing row — so the banner names
    // that instead of a conversation.
    selfServe =
      selfServeTiers(capabilities.billing.getPlanCatalog()?.tiers ?? null)
        .length > 0;
  } catch {
    // Never let a banner take the console down; the turn pipeline is where
    // activation is actually enforced.
    return null;
  }
  if (!pending) return null;

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-sm">
      <span className="flex items-center gap-2 font-medium">
        <Clock className="size-4 text-amber-500" />
        Pending activation
      </span>
      <span className="text-muted-foreground">
        {selfServe
          ? "Build your assistants now, they start answering as soon as you pick a plan."
          : "Build your assistants now, they start answering once we activate your organization."}
      </span>
      <Link
        href="/settings/billing"
        className="font-medium underline underline-offset-4"
      >
        {selfServe ? "Choose a plan" : "Talk to us"}
      </Link>
    </div>
  );
}
