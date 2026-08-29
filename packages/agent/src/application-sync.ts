import { createHash } from "node:crypto";
import { sealSecret, type ApplicationSyncRun } from "@agent-hub/core";
import type { Db } from "@agent-hub/db";
import type {
  ApplicationArtifact,
  ApplicationConnectorRegistry,
} from "./application-connectors";
import { ApplicationAuthorizationError } from "./application-provider-connectors";
import { alertKeys, signalHealth } from "./health";

function hashArtifact(artifact: ApplicationArtifact): string {
  return createHash("sha256")
    .update(artifact.title)
    .update("\0")
    .update(artifact.text)
    .digest("hex");
}

function stableApplicationSourceId(importId: string, remoteId: string): string {
  return `appsrc_${createHash("sha256")
    .update(importId)
    .update("\0")
    .update(remoteId)
    .digest("hex")
    .slice(0, 32)}`;
}

function nextSyncAt(cadence: "manual" | "daily", now: Date): string | null {
  return cadence === "daily"
    ? new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString()
    : null;
}

function validateArtifact(artifact: ApplicationArtifact): void {
  if (!artifact.remoteId.trim()) throw new Error("Connector returned an empty remote id");
  if (!artifact.title.trim()) {
    throw new Error(`Connector returned an untitled artifact (${artifact.remoteId})`);
  }
  if (!artifact.text.trim()) {
    throw new Error(`Connector returned empty content (${artifact.remoteId})`);
  }
}

function discoveredItemCount(input: {
  artifacts: ApplicationArtifact[];
  unchangedRemoteIds?: string[];
  deletedRemoteIds?: string[];
  completeRemoteIds?: string[];
  skipped?: Array<{ remoteId: string | null }>;
  failed?: Array<{ remoteId: string | null }>;
}): number {
  const identified = new Set(
    input.completeRemoteIds ?? [
      ...input.artifacts.map((item) => item.remoteId),
      ...(input.unchangedRemoteIds ?? []),
      ...(input.deletedRemoteIds ?? []),
    ]
  );
  let unidentified = 0;
  for (const outcome of [...(input.skipped ?? []), ...(input.failed ?? [])]) {
    if (outcome.remoteId) identified.add(outcome.remoteId);
    else unidentified += 1;
  }
  return identified.size + unidentified;
}

export interface ApplicationSyncInput {
  db: Db;
  organizationId: string;
  importId: string;
  connectors: ApplicationConnectorRegistry;
  now?: Date;
  onProgress?: () => Promise<void>;
}

/**
 * Synchronizes one Application Import through the provider-neutral seam.
 * Remote identity is stable, so a changed revision updates one Source rather
 * than replacing it and citations keep resolving to the same record.
 */
export async function syncApplicationImport(
  input: ApplicationSyncInput
): Promise<ApplicationSyncRun> {
  const { db, organizationId, importId, connectors } = input;
  const now = input.now ?? new Date();
  const timestamp = now.toISOString();
  const startedAtMs = Date.now();
  const applicationImport = await db.acquireApplicationImportSync(
    importId,
    organizationId
  );
  if (!applicationImport) {
    const current = await db.getApplicationImport(importId);
    if (!current || current.organizationId !== organizationId) {
      throw new Error("Application Import not found");
    }
    throw Object.assign(new Error("Application Import is paused"), {
      name: "ApplicationImportPausedError",
      retryable: false,
    });
  }
  const connection = await db.getApplicationConnection(
    applicationImport.connectionId
  );
  if (!connection || connection.organizationId !== organizationId) {
    throw new Error("Application Connection not found");
  }
  if (connection.status !== "connected") {
    throw new ApplicationAuthorizationError(
      "Application Connection requires authorization"
    );
  }
  const connector = connectors[connection.provider];
  if (!connector || connector.provider !== connection.provider) {
    throw new Error(`No Connector is registered for ${connection.provider}`);
  }

  let discovered = 0;
  let upserted = 0;
  let unchanged = 0;
  let deleted = 0;
  let skipped = 0;
  let failed = 0;
  let enqueued = 0;
  let providerCalls = 0;
  let bytes = 0;
  let organizationByteLimit: number | null = null;
  let skippedReasons: Array<{ remoteId: string | null; reason: string }> = [];
  try {
    const currentMappings = await db.listApplicationSources(importId);
    const currentSources = new Map(
      await Promise.all(
        currentMappings.flatMap((mapping) =>
          mapping.sourceId
            ? [db.getSource(mapping.sourceId).then((source) => [mapping.sourceId!, source] as const)]
            : []
        )
      )
    );
    const result = await connector.synchronize({
      connection,
      applicationImport,
      syncStartedAt: timestamp,
      knownArtifacts: Object.fromEntries(
        currentMappings.flatMap((mapping) =>
          mapping.sourceId && currentSources.get(mapping.sourceId)?.status === "ready"
            ? [
                [
                  mapping.remoteId,
                  {
                    revision: mapping.revision,
                    contentHash: mapping.contentHash,
                  },
                ] as const,
              ]
            : []
        )
      ),
      onCredentialsRefreshed: async (refreshedCredentials) => {
        await db.updateApplicationConnection(connection.id, {
          sealedCredentials: sealSecret(JSON.stringify(refreshedCredentials)),
          status: "connected",
          error: "",
          lastConnectedAt: timestamp,
        });
      },
      onProgress: input.onProgress,
    });
    const latestImport = await db.getApplicationImport(importId);
    if (!latestImport?.enabled) {
      throw Object.assign(new Error("Application Import is paused"), {
        name: "ApplicationImportPausedError",
        retryable: false,
      });
    }
    const artifacts = [...new Map(result.artifacts.map((item) => [item.remoteId, item])).values()];
    skipped = result.skipped?.length ?? 0;
    failed = result.failed?.length ?? 0;
    skippedReasons = [...(result.skipped ?? []), ...(result.failed ?? [])];
    providerCalls = result.metrics?.providerCalls ?? 0;
    bytes = result.metrics?.bytes ?? 0;
    discovered = discoveredItemCount({ ...result, artifacts });
    const existingMappings = new Map(
      currentMappings.map((mapping) => [mapping.remoteId, mapping])
    );
    const configuredLimit = Number(
      connection.metadata.applicationImportItemLimit ??
        process.env.APPLICATION_IMPORT_MAX_REMOTE_ITEMS ??
        100_000
    );
    const remoteItemLimit = Math.max(1, Math.min(configuredLimit, 1_000_000));
    const projectedRemoteIds = new Set(
      currentMappings.filter((mapping) => mapping.sourceId).map((mapping) => mapping.remoteId)
    );
    for (const artifact of artifacts) projectedRemoteIds.add(artifact.remoteId);
    for (const remoteId of result.unchangedRemoteIds ?? []) projectedRemoteIds.add(remoteId);
    for (const remoteId of result.deletedRemoteIds ?? []) projectedRemoteIds.delete(remoteId);
    if (projectedRemoteIds.size > remoteItemLimit) {
      throw Object.assign(
        new Error(`Application Import exceeds its ${remoteItemLimit} remote-item allowance`),
        { retryable: false }
      );
    }
    const configuredByteLimit = Number(
      connection.metadata.applicationOrganizationByteLimit ??
        process.env.APPLICATION_IMPORT_MAX_ORG_BYTES ??
        5 * 1024 * 1024 * 1024
    );
    const byteLimit = Math.max(
      1,
      Math.min(configuredByteLimit, 1024 * 1024 * 1024 * 1024)
    );
    organizationByteLimit = byteLimit;
    const removedForAllowance = new Set(result.deletedRemoteIds ?? []);
    for (const outcome of result.skipped ?? []) {
      if (outcome.remoteId) removedForAllowance.add(outcome.remoteId);
    }
    if (result.completeRemoteIds) {
      const complete = new Set(result.completeRemoteIds);
      for (const mapping of currentMappings) {
        if (mapping.sourceId && !complete.has(mapping.remoteId)) {
          removedForAllowance.add(mapping.remoteId);
        }
      }
    }
    const currentImportBytes = currentMappings
      .filter((mapping) => mapping.sourceId)
      .reduce((sum, mapping) => sum + mapping.contentBytes, 0);
    let projectedImportBytes = currentImportBytes;
    for (const remoteId of removedForAllowance) {
      const existing = existingMappings.get(remoteId);
      if (existing?.sourceId) projectedImportBytes -= existing.contentBytes;
    }
    for (const artifact of artifacts) {
      const existing = existingMappings.get(artifact.remoteId);
      if (existing?.sourceId && !removedForAllowance.has(artifact.remoteId)) {
        projectedImportBytes -= existing.contentBytes;
      }
      projectedImportBytes += new TextEncoder().encode(
        artifact.text
      ).byteLength;
    }
    let intermediateBytes = currentImportBytes;
    for (const remoteId of removedForAllowance) {
      const existing = existingMappings.get(remoteId);
      if (existing?.sourceId) intermediateBytes -= existing.contentBytes;
    }
    let peakMaterializedBytes = Math.max(0, intermediateBytes);
    for (const artifact of artifacts) {
      const existing = existingMappings.get(artifact.remoteId);
      if (existing?.sourceId && !removedForAllowance.has(artifact.remoteId)) {
        intermediateBytes -= existing.contentBytes;
      }
      intermediateBytes += new TextEncoder().encode(artifact.text).byteLength;
      peakMaterializedBytes = Math.max(
        peakMaterializedBytes,
        intermediateBytes
      );
    }
    const reserved = await db.reserveApplicationKnowledgeBytes({
      importId,
      organizationId,
      projectedBytes: Math.max(
        applicationImport.reservedBytes,
        currentImportBytes,
        peakMaterializedBytes,
        Math.max(0, projectedImportBytes)
      ),
      limitBytes: byteLimit,
    });
    if (!reserved) {
      throw Object.assign(
        new Error(
          `Application knowledge exceeds its ${byteLimit}-byte Organization allowance`
        ),
        { retryable: false }
      );
    }
    if (result.refreshedCredentials) {
      await db.updateApplicationConnection(connection.id, {
        sealedCredentials: sealSecret(JSON.stringify(result.refreshedCredentials)),
        status: "connected",
        error: "",
        lastConnectedAt: timestamp,
      });
    }

    for (const remoteId of new Set(result.unchangedRemoteIds ?? [])) {
      await input.onProgress?.();
      const mapping = existingMappings.get(remoteId);
      if (!mapping?.sourceId) continue;
      await db.upsertApplicationSource({
        importId,
        sourceId: mapping.sourceId,
        remoteId,
        canonicalUrl: mapping.canonicalUrl,
        revision: mapping.revision,
        contentHash: mapping.contentHash,
        contentBytes: mapping.contentBytes,
        remoteMimeType: mapping.remoteMimeType,
        remoteUpdatedAt: mapping.remoteUpdatedAt,
        lastSeenAt: timestamp,
      });
      unchanged += 1;
    }
    const deletedRemoteIds = new Set(result.deletedRemoteIds ?? []);
    // Connector `skipped` outcomes are deterministic (unsupported/empty/
    // malformed). Transient transport, auth and rate-limit failures throw, so
    // an existing version must be removed instead of remaining stale forever.
    for (const outcome of result.skipped ?? []) {
      if (outcome.remoteId && existingMappings.has(outcome.remoteId)) {
        deletedRemoteIds.add(outcome.remoteId);
      }
    }
    if (result.completeRemoteIds) {
      const complete = new Set(result.completeRemoteIds);
      for (const mapping of existingMappings.values()) {
        if (mapping.sourceId && !complete.has(mapping.remoteId)) {
          deletedRemoteIds.add(mapping.remoteId);
        }
      }
    }
    if (result.completeSnapshotStartedAt && !result.continuationRequired) {
      for (const mapping of existingMappings.values()) {
        if (
          mapping.sourceId &&
          mapping.lastSeenAt < result.completeSnapshotStartedAt
        ) {
          deletedRemoteIds.add(mapping.remoteId);
        }
      }
    }
    for (const remoteId of deletedRemoteIds) {
      await input.onProgress?.();
      const mapping = existingMappings.get(remoteId);
      if (!mapping) continue;
      if (mapping.sourceId) await db.deleteSource(mapping.sourceId);
      await db.markApplicationSourceRemoved(importId, remoteId, timestamp);
      deleted += 1;
    }
    const fallbackAssistant =
      applicationImport.assistantIds[0] ??
      (await db.listAssistants(organizationId))[0]?.id ??
      null;

    for (const artifact of artifacts) {
      await input.onProgress?.();
      try {
        validateArtifact(artifact);
      } catch {
        failed += 1;
        skippedReasons.push({
          remoteId: artifact.remoteId || null,
          reason: "invalid_normalized_artifact",
        });
        continue;
      }
      const contentHash = hashArtifact(artifact);
      const contentBytes = new TextEncoder().encode(artifact.text).byteLength;
      const existing = existingMappings.get(artifact.remoteId);
      let source = existing?.sourceId
        ? currentSources.get(existing.sourceId) ?? null
        : await db.getSource(stableApplicationSourceId(importId, artifact.remoteId));
      const changed =
        !existing ||
        !existing.sourceId ||
        source?.status !== "ready" ||
        existing.contentHash !== contentHash ||
        existing.revision !== artifact.revision;
      const config = {
        applicationProvider: connection.provider,
        applicationImportId: importId,
        remoteId: artifact.remoteId,
        remoteUrl: artifact.canonicalUrl,
        remoteRevision: artifact.revision,
        remoteUpdatedAt: artifact.updatedAt,
        remoteMetadata: artifact.metadata,
      } as const;

      if (!source) {
        source = await db.createSource({
          id: stableApplicationSourceId(importId, artifact.remoteId),
          collectionId: applicationImport.collectionId,
          name: artifact.title,
          kind: "application",
          config,
        });
      } else if (changed) {
        await db.updateSource(source.id, {
          name: artifact.title,
          status: "processing",
          error: "",
          config,
        });
        source = (await db.getSource(source.id)) ?? source;
      }

      await db.upsertApplicationSource({
        importId,
        sourceId: source.id,
        remoteId: artifact.remoteId,
        canonicalUrl: artifact.canonicalUrl,
        revision: artifact.revision,
        contentHash,
        contentBytes,
        remoteMimeType: artifact.mimeType ?? null,
        remoteUpdatedAt: artifact.updatedAt,
        lastSeenAt: timestamp,
      });
      await db.syncApplicationSourceAssistantScope(importId, source.id);

      if (changed) {
        upserted += 1;
        if (fallbackAssistant) {
          const samePendingRevision =
            existing?.contentHash === contentHash &&
            existing.revision === artifact.revision;
          const activeJob = samePendingRevision &&
            (await db.listBackgroundJobsForSource(source.id, "ingest_source"))
              .some((job) => job.status === "queued" || job.status === "running");
          if (!activeJob) {
            await db.stageSourceIngestJob({
              assistantId: fallbackAssistant,
              collectionId: applicationImport.collectionId,
              sourceId: source.id,
              rawText: artifact.text,
            });
            enqueued += 1;
          }
        }
      } else {
        unchanged += 1;
      }
    }

    const reconciled = await db.reserveApplicationKnowledgeBytes({
      importId,
      organizationId,
      projectedBytes: Math.max(0, projectedImportBytes),
      limitBytes: byteLimit,
    });
    if (!reconciled) {
      throw new Error("Application knowledge byte reservation could not be reconciled");
    }

    await db.updateApplicationImport(importId, {
      status: result.continuationRequired ? "syncing" : "ready",
      checkpoint: result.checkpoint,
      error: "",
      lastSyncedAt: timestamp,
      nextSyncAt: result.continuationRequired
        ? timestamp
        : nextSyncAt(applicationImport.cadence, now),
    });
    const run = await db.recordApplicationSyncRun(importId, {
      status: "succeeded",
      discovered,
      upserted,
      unchanged,
      deleted,
      skipped,
      failed,
      enqueued,
      providerCalls,
      bytes,
      durationMs: Math.max(0, Date.now() - startedAtMs),
      skippedReasons,
      error: "",
      startedAt: timestamp,
      completedAt: timestamp,
    });
    if (!result.continuationRequired) {
      await signalHealth(
        db,
        organizationId,
        { key: alertKeys.applicationImport(importId), healthy: true },
        "application-sync"
      );
      await signalHealth(
        db,
        organizationId,
        { key: alertKeys.applicationConnection(connection.id), healthy: true },
        "application-sync"
      );
    }
    return run;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Application sync failed";
    if (organizationByteLimit !== null) {
      try {
        const activeMappings = await db.listApplicationSources(importId);
        const materializedBytes = activeMappings
          .filter((mapping) => mapping.sourceId)
          .reduce((sum, mapping) => sum + mapping.contentBytes, 0);
        await db.reserveApplicationKnowledgeBytes({
          importId,
          organizationId,
          projectedBytes: materializedBytes,
          limitBytes: organizationByteLimit,
        });
      } catch {
        // The pre-write reservation never undercounts materialized bytes. A
        // later run can retry this best-effort reconciliation.
      }
    }
    if (
      error instanceof Error &&
      error.name === "ApplicationImportPausedError"
    ) {
      await db.updateApplicationImport(importId, {
        status: "idle",
        error: "",
        nextSyncAt: null,
      });
      throw error;
    }
    if (error instanceof ApplicationAuthorizationError) {
      await db.updateApplicationConnection(connection.id, {
        status: "reauthorization_required",
        error: message,
      });
      await signalHealth(
        db,
        organizationId,
        {
          key: alertKeys.applicationConnection(connection.id),
          healthy: false,
          alert: {
            type: "integration",
            title: "Application connection requires authorization",
            detail: `${connection.name} must be reconnected before knowledge can synchronize.`,
          },
        },
        "application-sync"
      );
    }
    await db.updateApplicationImport(importId, { status: "error", error: message });
    await db.recordApplicationSyncRun(importId, {
      status: "failed",
      discovered,
      upserted,
      unchanged,
      deleted,
      skipped,
      failed: Math.max(1, failed),
      enqueued,
      providerCalls,
      bytes,
      durationMs: Math.max(0, Date.now() - startedAtMs),
      skippedReasons,
      error: message,
      startedAt: timestamp,
      completedAt: timestamp,
    });
    await signalHealth(
      db,
      organizationId,
      {
        key: alertKeys.applicationImport(importId),
        healthy: false,
        alert: {
          type: "integration",
          title: "Application knowledge sync failed",
          detail: `${applicationImport.name} could not synchronize. ${message}`,
        },
      },
      "application-sync"
    );
    throw error;
  }
}
