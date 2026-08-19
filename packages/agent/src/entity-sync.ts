import type {
  Entity,
  EntityRecordValue,
  EntitySyncConfig,
  EntitySyncRun,
} from "@agent-hub/core";
import { coerceEntityValue, openSecret } from "@agent-hub/core";
import type { Db } from "@agent-hub/db";
import { egressFetch } from "./egress";
import { alertKeys, signalHealth } from "./health";

/**
 * Synced Record ingestion (#670): one sync run, fetch a REST/JSON source
 * through the guarded egress path, map JSON fields to the Entity's typed
 * attributes (same forgiving semantics as the CSV import), validate per
 * row, upsert idempotently by the key attribute, optionally prune Records
 * unseen in this run, and record a per-run report. A failing run raises an
 * Alert (auto-resolving on the next success); retry/backoff is the job
 * layer's, not ours.
 */

const SYNC_TIMEOUT_MS = 30_000;
const SYNC_MAX_RESPONSE_BYTES = 10 * 1024 * 1024;
/** Mirrors ENTITY_IMPORT_MAX_ROWS, one sync can't become an unbounded write burst. */
export const ENTITY_SYNC_MAX_ROWS = 5000;

/** Test seam: replaces the guarded egress fetch. */
export type SyncFetcher = (
  url: string,
  headers: Record<string, string>
) => Promise<unknown>;

const defaultFetcher: SyncFetcher = async (url, headers) => {
  const { response } = await egressFetch(url, {
    method: "GET",
    headers: { accept: "application/json", ...headers },
    timeoutMs: SYNC_TIMEOUT_MS,
    maxResponseBytes: SYNC_MAX_RESPONSE_BYTES,
  });
  if (!response.ok) {
    throw new Error(`Sync source returned HTTP ${response.status}`);
  }
  try {
    return JSON.parse(response.text) as unknown;
  } catch {
    throw new Error("Sync source did not return valid JSON");
  }
};

/** The row list inside a JSON payload: a bare array or a conventional wrapper. */
function extractRows(payload: unknown): Array<Record<string, unknown>> | null {
  const candidates = Array.isArray(payload)
    ? payload
    : payload && typeof payload === "object"
      ? ((payload as Record<string, unknown>).items ??
        (payload as Record<string, unknown>).records ??
        (payload as Record<string, unknown>).results ??
        (payload as Record<string, unknown>).data)
      : null;
  if (!Array.isArray(candidates)) return null;
  return candidates.filter(
    (row): row is Record<string, unknown> =>
      Boolean(row) && typeof row === "object" && !Array.isArray(row)
  );
}


export interface MappedSyncRows {
  rows: Array<{ key: string; values: Record<string, EntityRecordValue> }>;
  rejected: string[];
}

/**
 * Map raw JSON rows onto the Entity's schema. `mapping` is JSON field →
 * attribute key; attributes without a mapping entry read the field named
 * like their key. Rows are rejected individually (1-based reports), one
 * bad row never blocks the batch.
 */
export function mapSyncRows(
  raw: Array<Record<string, unknown>>,
  entity: Entity,
  mapping: Record<string, string>
): MappedSyncRows {
  // Invert to attribute key → source field (last mapping entry wins).
  const fieldFor = new Map<string, string>();
  for (const attribute of entity.attributes) fieldFor.set(attribute.key, attribute.key);
  for (const [field, attributeKey] of Object.entries(mapping)) {
    if (fieldFor.has(attributeKey)) fieldFor.set(attributeKey, field);
  }

  const rows: MappedSyncRows["rows"] = [];
  const rejected: string[] = [];
  const seenKeys = new Set<string>();
  raw.slice(0, ENTITY_SYNC_MAX_ROWS).forEach((row, index) => {
    const line = index + 1;
    const values: Record<string, EntityRecordValue> = {};
    for (const attribute of entity.attributes) {
      const parsed = coerceEntityValue(row[fieldFor.get(attribute.key)!], attribute);
      if (!parsed.ok) {
        rejected.push(`row ${line}: ${parsed.reason}`);
        return;
      }
      values[attribute.key] = parsed.value;
    }
    const key = values[entity.keyAttribute];
    if (key === null || key === undefined || String(key).trim() === "") {
      rejected.push(`row ${line}: missing key attribute "${entity.keyAttribute}"`);
      return;
    }
    const keyText = String(key);
    if (seenKeys.has(keyText)) {
      rejected.push(`row ${line}: duplicate key "${keyText}" (kept the first)`);
      return;
    }
    seenKeys.add(keyText);
    rows.push({ key: keyText, values });
  });
  if (raw.length > ENTITY_SYNC_MAX_ROWS) {
    rejected.push(
      `source returned ${raw.length} rows; only the first ${ENTITY_SYNC_MAX_ROWS} were processed`
    );
  }
  return { rows, rejected };
}

function isDue(config: EntitySyncConfig, now: Date): boolean {
  if (!config.lastSyncedAt) return true;
  return (
    new Date(config.lastSyncedAt).getTime() + config.cadenceHours * 3_600_000 <=
    now.getTime()
  );
}

export interface EntitySyncInput {
  db: Db;
  entityId: string;
  organizationId: string;
  /** "Sync now" bypasses the cadence check. */
  force?: boolean;
  now?: Date;
  fetcher?: SyncFetcher;
}

/**
 * One sync run. Returns the recorded run, or null when it no-ops (config or
 * Entity gone, or a duplicate sweep enqueue inside the cadence window).
 * Throws after recording a failed run + raising the Alert, so the job layer
 * applies retry/backoff.
 */
export async function runEntitySync(input: EntitySyncInput): Promise<EntitySyncRun | null> {
  const { db, entityId, organizationId } = input;
  const now = input.now ?? new Date();
  const fetcher = input.fetcher ?? defaultFetcher;

  const [config, entity] = await Promise.all([
    db.getEntitySyncConfig(entityId),
    db.table("entities").get(entityId),
  ]);
  if (!config || !entity || entity.organizationId !== organizationId) return null;
  if (!input.force && !isDue(config, now)) return null;

  try {
    const headers: Record<string, string> = {};
    if (config.sealedHeaders) {
      for (const pair of JSON.parse(openSecret(config.sealedHeaders)) as Array<{
        name: string;
        value: string;
      }>) {
        if (pair.name) headers[pair.name] = pair.value;
      }
    }

    const payload = await fetcher(config.url, headers);
    const rawRows = extractRows(payload);
    if (!rawRows) {
      throw new Error("Sync source did not return a JSON array of records");
    }

    const { rows, rejected } = mapSyncRows(rawRows, entity, config.mapping);
    const upserted = await db.upsertEntityRecords(entityId, rows);
    // Prune deliberately skips a run with zero valid rows: an empty (or
    // fully rejected) response is far likelier a source hiccup than a real
    // "everything was deleted", say so in the report instead of wiping.
    const pruned =
      config.prune && rows.length > 0
        ? await db.pruneEntityRecords(entityId, rows.map((r) => r.key))
        : 0;
    if (config.prune && rows.length === 0) {
      rejected.push("prune skipped: the source returned no valid rows");
    }

    const run = await db.recordEntitySyncRun(entityId, {
      status: "succeeded",
      upserted,
      pruned,
      rejected,
      error: null,
    });
    await db.markEntitySynced(entityId, now.toISOString());
    await signalHealth(
      db,
      organizationId,
      { key: alertKeys.entitySync(entityId), healthy: true },
      "entity-sync"
    );
    return run;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sync failed";
    await db.recordEntitySyncRun(entityId, {
      status: "failed",
      upserted: 0,
      pruned: 0,
      rejected: [],
      error: message,
    });
    await signalHealth(
      db,
      organizationId,
      {
        key: alertKeys.entitySync(entityId),
        healthy: false,
        alert: {
          type: "integration",
          title: `Data sync failing for "${entity.name}"`,
          detail: message,
        },
      },
      "entity-sync"
    );
    throw error;
  }
}
