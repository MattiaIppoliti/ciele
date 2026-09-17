import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getDb } from "@/lib/data";
import {
  canAuthorizeApplicationProvider,
  canReconnectApplicationConnection,
} from "@/lib/application-connections";
import {
  applicationOAuthAvailability,
  isApplicationOAuthProvider,
  safeApplicationReturnTo,
} from "@/lib/application-oauth";
import { ApplicationConnect } from "@/components/knowledge/application-connect";

export const dynamic = "force-dynamic";

export default async function ApplicationConnectPage({ params, searchParams }: {
  params: Promise<{ provider: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { provider } = await params;
  // Instance-specific providers keep their protected credential form.
  if (!isApplicationOAuthProvider(provider) || provider === "salesforce" || provider === "servicenow") {
    notFound();
  }
  const query = await searchParams;
  const returnTo = safeApplicationReturnTo(typeof query.returnTo === "string" ? query.returnTo : null);
  const connectionId = typeof query.connectionId === "string" ? query.connectionId : undefined;
  const continuation = new URLSearchParams({ returnTo });
  if (connectionId) continuation.set("connectionId", connectionId);
  const session = await getSession();
  if (!session) {
    const next = `/application-connect/${provider}?${continuation}`;
    redirect(`/login?${new URLSearchParams({ next })}`);
  }
  if (!session.organization || !canAuthorizeApplicationProvider(provider, session.role)) notFound();

  if (connectionId) {
    const connection = await (await getDb()).getSafeApplicationConnection(connectionId);
    if (
      !connection ||
      connection.organizationId !== session.organization.id ||
      connection.provider !== provider ||
      !canReconnectApplicationConnection(connection, session.userId, session.role)
    ) notFound();
  }

  return (
    <ApplicationConnect
      provider={provider}
      returnTo={returnTo}
      connectionId={connectionId}
      organizationName={session.organization.name}
      configured={applicationOAuthAvailability()[provider].configured && Boolean(process.env.APP_ENCRYPTION_KEY)}
      showSetupGuide={session.role === "owner" || session.role === "admin"}
    />
  );
}
