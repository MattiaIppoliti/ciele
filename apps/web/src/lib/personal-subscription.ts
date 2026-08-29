import type { Db } from "@agent-hub/db";
import {
  connectedLocalSubscriptionProviders,
  createLocalCliRunner,
  isLocalSubscriptionDirectEnabled,
  isLoopbackHost,
  listLocalSubscriptionStatuses,
  verifiedLocalSubscriptionProviders,
  type LocalCliRunner,
  type LocalSubscriptionProvider,
} from "@agent-hub/agent/local-providers";
import {
  createRelayCliRunner,
  listActiveRelayProviders,
} from "@/lib/local-inference-relay";

/**
 * Which personal provider subscriptions may power **this Member's own** turn
 * (ADR-0015, ADR-0007 as amended by #769).
 *
 * Two chat surfaces ask the same question now, the Assistant Preview and the
 * Teammate chat, so the answer lives in one place. Getting it wrong in one of
 * them would mean either a dead capability or, far worse, one Member's
 * subscription paying for another Member's turn.
 *
 * Everything here keys on `userId`. The relay lookup returns the devices that
 * Member paired, and the direct path probes the CLIs authenticated on the
 * machine serving a loopback request, which is theirs by construction. A
 * colleague asking the same Teammate therefore resolves nothing and falls
 * through to the Organization's own connections.
 */
export interface PersonalSubscription {
  providers: LocalSubscriptionProvider[];
  runner: LocalCliRunner | undefined;
}

const NONE: PersonalSubscription = { providers: [], runner: undefined };

export async function resolvePersonalSubscription(args: {
  db: Db;
  organizationId: string;
  userId: string;
  /** Request host, for the loopback check the direct dev path requires. */
  host: string | null;
  /** Request origin, where the connector relay is polled. */
  origin: string;
}): Promise<PersonalSubscription> {
  const { db, organizationId, userId, host, origin } = args;

  // The Organization owner opts in once; without it no Member's subscription
  // runs anything, whatever they have paired.
  const allowed = await db.getPersonalAiSubscriptionsAllowed(organizationId);
  if (!allowed) return NONE;

  // The same-process development path: only outside production, only over a
  // loopback host, so the CLIs it probes are the ones on this Member's Mac.
  if (isLocalSubscriptionDirectEnabled() && isLoopbackHost(host)) {
    const runner = createLocalCliRunner();
    const providers = await verifiedLocalSubscriptionProviders(
      connectedLocalSubscriptionProviders(await listLocalSubscriptionStatuses()),
      runner
    );
    if (providers.length > 0) return { providers, runner };
  }

  // The hosted path: the paired Ciele Connector, scoped to (org, member). A
  // relay failure is not an error the Member should see; the turn runs on the
  // Organization's connections instead.
  try {
    const providers = await listActiveRelayProviders({
      organizationId,
      userId,
      origin,
    });
    if (providers.length === 0) return NONE;
    return {
      providers,
      runner: createRelayCliRunner({ organizationId, userId, origin }),
    };
  } catch (error) {
    console.error("[chat] local connector relay unavailable:", error);
    return NONE;
  }
}
