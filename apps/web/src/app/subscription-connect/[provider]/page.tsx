import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { LocalSubscriptionConnect } from "@/components/settings/local-subscription-connect";
import { getSession } from "@/lib/auth";
import { getDb } from "@/lib/data";
import {
  LOCAL_SUBSCRIPTION_PROVIDERS,
  isLocalSubscriptionProvider,
  isLocalSubscriptionTestEnabled,
  isLoopbackHost,
} from "@/lib/local-subscriptions";

export const dynamic = "force-dynamic";

export default async function SubscriptionConnectPage({
  params,
}: {
  params: Promise<{ provider: string }>;
}) {
  const requestHeaders = await headers();
  if (
    !isLocalSubscriptionTestEnabled() ||
    !isLoopbackHost(requestHeaders.get("host"))
  ) {
    notFound();
  }

  const session = await getSession();
  if (!session?.organization) notFound();
  const db = await getDb();
  if (!(await db.getPersonalAiSubscriptionsAllowed(session.organization.id))) notFound();

  const { provider } = await params;
  if (!isLocalSubscriptionProvider(provider)) notFound();

  return (
    <LocalSubscriptionConnect
      provider={provider}
      label={LOCAL_SUBSCRIPTION_PROVIDERS[provider].label}
    />
  );
}
