import type {
  LocalConnectorDevice,
  LocalConnectorPairing,
  LocalInferenceJob,
  Skill,
} from "./types";
import { shortId } from "./id";

/**
 * Generic typed table access — ADR-0016 stage 1.
 *
 * `Db.table(name)` is the seam the ~125 one-per-table CRUD passthroughs
 * migrate onto (stages 3–4). A table qualifies for this map only when its
 * column mapping is mechanical (camelCase field ↔ snake_case column, values
 * passed through verbatim) and its writes carry no semantics beyond
 * insert/patch/delete. Anything else — leases, counters, dedup, sealed
 * credentials, derived JSON — stays a named behavioural method on `Db`.
 *
 * Adding a table costs one `DbTableMap` entry + one `DB_TABLE_SPECS` row
 * (plus a store binding in the mock), not three hand-written methods.
 */
export interface DbTableMap {
  skills: {
    row: Skill;
    insert: {
      organizationId: string;
      name: string;
      prompt: string;
      description?: string;
    };
    update: Partial<Pick<Skill, "name" | "description" | "prompt">>;
  };
  localConnectorPairings: {
    row: LocalConnectorPairing;
    insert: {
      organizationId: string;
      userId: string;
      codeHash: string;
      origin: string;
      expiresAt: string;
    };
    update: Partial<Pick<LocalConnectorPairing, "usedAt">>;
  };
  localConnectorDevices: {
    row: LocalConnectorDevice;
    insert: {
      organizationId: string;
      userId: string;
      tokenHash: string;
      origin: string;
      providers?: string[];
    };
    update: Partial<
      Pick<LocalConnectorDevice, "providers" | "lastSeenAt" | "revokedAt">
    >;
  };
  localInferenceJobs: {
    row: LocalInferenceJob;
    insert: {
      deviceId: string;
      organizationId: string;
      userId: string;
      provider: string;
      modelId: string;
      invocation: Record<string, unknown>;
      expiresAt: string;
    };
    update: Partial<
      Pick<
        LocalInferenceJob,
        "status" | "result" | "error" | "claimedAt" | "completedAt"
      >
    >;
  };
}

export type DbTableName = keyof DbTableMap;
export type DbTableRow<K extends DbTableName> = DbTableMap[K]["row"];
export type DbTableInsert<K extends DbTableName> = DbTableMap[K]["insert"];
export type DbTableUpdate<K extends DbTableName> = DbTableMap[K]["update"];

export interface DbTableListOptions<K extends DbTableName> {
  /** Field to order by (domain name; defaults to the table spec's order). */
  orderBy?: Extract<keyof DbTableRow<K>, string>;
  ascending?: boolean;
  limit?: number;
}

/**
 * The five operations every mapped table shares. Filters and patches are
 * expressed in domain field names; `null` filter values match SQL NULL.
 * `update` rejects when the id doesn't exist; `delete` of a missing id is a
 * no-op (both adapters, pinned by the contract suite).
 */
export interface DbTableAccessor<K extends DbTableName> {
  list(
    filter?: Partial<DbTableRow<K>>,
    options?: DbTableListOptions<K>
  ): Promise<DbTableRow<K>[]>;
  get(id: string): Promise<DbTableRow<K> | null>;
  insert(values: DbTableInsert<K>): Promise<DbTableRow<K>>;
  update(id: string, patch: DbTableUpdate<K>): Promise<DbTableRow<K>>;
  delete(id: string): Promise<void>;
}

/** Adapter-shared, per-table facts. Both adapters read the same spec so
 * defaults and ordering can't drift. */
export interface DbTableSpec<K extends DbTableName> {
  /** Postgres table name. */
  table: string;
  /** Primary-key shape: public short id vs. uuid column (both client-generated). */
  id: "shortId" | "uuid";
  /** Values merged under `insert` input (identical across adapters). */
  defaults: Partial<DbTableRow<K>>;
  /** Default list ordering. */
  orderBy: Extract<keyof DbTableRow<K>, string>;
  ascending: boolean;
  /** Whether `update` stamps `updatedAt` (tables with an updated_at column). */
  touchesUpdatedAt: boolean;
}

export const DB_TABLE_SPECS: { [K in DbTableName]: DbTableSpec<K> } = {
  skills: {
    table: "skills",
    id: "shortId",
    defaults: { description: "" },
    orderBy: "createdAt",
    ascending: true,
    touchesUpdatedAt: true,
  },
  localConnectorPairings: {
    table: "local_connector_pairings",
    id: "uuid",
    defaults: { usedAt: null },
    orderBy: "createdAt",
    ascending: true,
    touchesUpdatedAt: false,
  },
  localConnectorDevices: {
    table: "local_connector_devices",
    id: "uuid",
    defaults: { providers: [], lastSeenAt: null, revokedAt: null },
    orderBy: "createdAt",
    ascending: true,
    touchesUpdatedAt: false,
  },
  localInferenceJobs: {
    table: "local_inference_jobs",
    id: "uuid",
    defaults: {
      status: "pending",
      result: null,
      error: null,
      claimedAt: null,
      completedAt: null,
    },
    orderBy: "createdAt",
    ascending: true,
    touchesUpdatedAt: false,
  },
};

/** New primary key for a generic-accessor insert, per the table's id shape. */
export function newTableRowId<K extends DbTableName>(
  spec: DbTableSpec<K>
): string {
  return spec.id === "uuid" ? crypto.randomUUID() : shortId();
}

/** organizationId → organization_id. Mechanical by construction — tables
 * whose mapping isn't mechanical don't belong in `DbTableMap`. */
export function camelToSnakeKey(key: string): string {
  return key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

/** organization_id → organizationId. */
export function snakeToCamelKey(key: string): string {
  return key.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

/** Rewrites an object's keys camelCase → snake_case, dropping `undefined`. */
export function domainToRow(
  values: Record<string, unknown>
): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) continue;
    row[camelToSnakeKey(key)] = value;
  }
  return row;
}

/** Rewrites an object's keys snake_case → camelCase. */
export function rowToDomain(row: Record<string, unknown>): Record<string, unknown> {
  const domain: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    domain[snakeToCamelKey(key)] = value;
  }
  return domain;
}
