import type { AlertType, Db } from "@agent-hub/db";

/**
 * Keyed operational-health signals — the one home for the raise-on-unhealthy /
 * auto-resolve-on-recovery Alert idiom every runtime producer uses.
 *
 * `alertKeys` is the registry of sourceKey namespaces: producers construct
 * keys only through it, so two producers can never collide on a prefix and
 * the full key vocabulary is greppable in one place. The key formats are
 * persisted in live alerts — never change an existing format, or open alerts
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
  /** Monthly plan-cap ladder (EE metering enforcement, #442), per organization. */
  planCap: (organizationId: string) => `plan-cap:${organizationId}`,
  /** Flow trust-tier demotions (flow trust ledger). */
  flowTrust: (flowId: string) => `flow-trust:${flowId}`,
  /** Standing-goal verification failures. */
  goal: (goalId: string) => `goal:${goalId}`,
  /** Graph knowledge worker reachability, per organization (ADR-0017). */
  graphWorker: (organizationId: string) => `graph-worker:${organizationId}`,
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
 * failures are logged (under `logLabel`) and swallowed here — callers never
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
