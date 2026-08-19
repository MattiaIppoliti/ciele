import type { AlertType, UsageResource } from "@agent-hub/core";
import type { Db } from "@agent-hub/db";
import type { ProviderHealthEvent } from "./engine";
import type { UsageWindowName } from "./ee";

/**
 * Keyed operational-health signals, the one home for the raise-on-unhealthy /
 * auto-resolve-on-recovery Alert idiom every runtime producer uses.
 *
 * `alertKeys` is the registry of sourceKey namespaces: producers construct
 * keys only through it, so two producers can never collide on a prefix and
 * the full key vocabulary is greppable in one place. The key formats are
 * persisted in live alerts, never change an existing format, or open alerts
 * stop auto-resolving.
 */
export const alertKeys = {
  /** Embedding-provider failure while indexing an assistant's knowledge. */
  embedding: (assistantId: string) => `embedding:${assistantId}`,
  /** A website Source's crawl lifecycle (crawl failed / recovered). */
  websiteSource: (sourceId: string) => `website-source:${sourceId}`,
  /** A non-website Source's ingestion lifecycle. */
  ingestSource: (sourceId: string) => `ingest-source:${sourceId}`,
  /** Federated provider auth health, per provider+credential kind. */
  provider: (provider: string, credentialKind: string) =>
    `provider:${provider}:${credentialKind}`,
  /** Daily AI budget ceiling, per organization. */
  budget: (organizationId: string) => `budget:${organizationId}`,
  /**
   * Plan-cap ladder (EE metering enforcement, #442/#507): one key per
   * (organization, metered resource, window), so a scraping warning and an AI
   * block are separate banners that resolve independently. The single-key
   * `plan-cap:<org>` format this replaces never reached production, nothing
   * ever wrote the caps table, so no cap alert could have been raised.
   */
  planCap: (
    organizationId: string,
    resource: UsageResource,
    window: UsageWindowName
  ) => `plan-cap:${organizationId}:${resource}:${window}`,
  /** Flow trust-tier demotions (flow trust ledger). */
  flowTrust: (flowId: string) => `flow-trust:${flowId}`,
  /** Standing-goal verification failures. */
  goal: (goalId: string) => `goal:${goalId}`,
  /** Graph knowledge worker reachability, per organization (ADR-0017). */
  graphWorker: (organizationId: string) => `graph-worker:${organizationId}`,
  /** Per-Entity Record sync lifecycle (sync failed / recovered, #670). */
  entitySync: (entityId: string) => `entity-sync:${entityId}`,
} as const;

export type HealthSignal =
  | { key: string; healthy: true }
  | {
      key: string;
      healthy: false;
      alert: { type: AlertType; title: string; detail: string };
    };

/**
 * The unhealthy→raise / healthy→auto-resolve state machine, best-effort by
 * construction: alerting must never break the operation that reports it, so
 * failures are logged (under `logLabel`) and swallowed here, callers never
 * wrap this in their own try/catch.
 */
export async function signalHealth(
  db: Db,
  organizationId: string,
  signal: HealthSignal,
  logLabel = "runtime"
): Promise<void> {
  try {
    if (signal.healthy) {
      await db.resolveAlertsByKey(organizationId, signal.key);
    } else {
      await db.raiseAlert(organizationId, {
        ...signal.alert,
        sourceKey: signal.key,
      });
    }
  } catch (error) {
    console.error(`[${logLabel}] alert update failed:`, error);
  }
}

/**
 * Federated-provider auth health as a keyed signal: a failed answer raises a
 * per-(provider, credential kind) Alert, a later success auto-resolves it.
 */
export async function recordProviderHealth(input: {
  db: Db;
  organizationId: string;
  assistantTitle: string;
  event: ProviderHealthEvent;
}): Promise<void> {
  const key = alertKeys.provider(input.event.provider, input.event.credentialKind);
  await signalHealth(
    input.db,
    input.organizationId,
    input.event.ok
      ? { key, healthy: true }
      : {
          key,
          healthy: false,
          alert: {
            type: "provider",
            title:
              input.event.provider === "google"
                ? "Google Vertex federated auth failed"
                : "Federated provider auth failed",
            detail: `${input.assistantTitle} failed to answer using ${input.event.provider} ${input.event.credentialKind}. ${input.event.detail ?? "Check the provider connection in Settings > AI."}`,
          },
        },
    "provider-health"
  );
}
