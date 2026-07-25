import { Link } from "@/components/ui/link";
import { ChevronLeft } from "lucide-react";
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
import { getEnterpriseCapabilities } from "@/lib/runtime";
import { ActivationStatusCard } from "@/components/settings/activation-status-card";

export const dynamic = "force-dynamic";

/**
 * Billing and activation (#444).
 *
 * On a self-hosted deployment there is nothing to bill: the enterprise
 * capabilities are their OSS defaults, so the organization reads as active
 * with no subscription and this page says exactly that. On the managed
 * platform the same page carries the activation state, the talk-to-us CTA
 * while pending, and the checkout hand-off once staff have set a plan.
 */
export default async function BillingPage() {
  const { session, role } = await requirePageMember();
  if (!canManageMembers(role)) redirect("/");

  const capabilities = getEnterpriseCapabilities();
  const [activation, subscription] = await Promise.all([
    capabilities.activation.getActivation(session.organization.id),
    capabilities.billing.getSubscription(session.organization.id),
  ]);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl px-8 py-8">
        <div className="flex items-center gap-2">
          <Link
            href="/"
            className="flex items-center gap-1 text-sm font-medium underline underline-offset-4 hover:opacity-70"
          >
            <ChevronLeft className="size-4" strokeWidth={3} />
            All assistants
          </Link>
        </div>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight">Billing</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {session.organization.name}&apos;s plan and activation status.
        </p>

        <ActivationStatusCard
          activation={activation}
          subscription={subscription}
        />

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
      </div>
    </div>
  );
}
