import type {
  CookieConsentRecord,
  AssistantGoal,
  GoalExpectations,
  LocalConnectorDevice,
  LocalConnectorPairing,
  LocalInferenceJob,
  Entity,
  EntityInput,
  Skill,
  Project,
  ProjectInput,
  ProjectPatch,
  Teammate,
  TeammateChannel,
  TeammateChannelInput,
  TeammateChannelParticipant,
  TeammateChannelParticipantInput,
  TeammateChannelPatch,
  TeammateGovernancePatch,
  TeammateRoutine,
  TeammateRoutineInput,
  TeammateRoutinePatch,
  TeammateGrant,
  TeammateRosterHidden,
  TeammateGrantDomain,
  TeammateInput,
  TeammatePatch,
} from "@agent-hub/core";
import { shortId } from "@agent-hub/core";

/**
 * Generic typed table access: ADR-0016 stage 1.
 *
 * `Db.table(name)` is the seam the ~125 one-per-table CRUD passthroughs
 * migrate onto (stages 3–4). A table qualifies for this map only when its
 * column mapping is mechanical (camelCase field ↔ snake_case column, values
 * passed through verbatim) and its writes carry no semantics beyond
 * insert/patch/delete. Anything else, leases, counters, dedup, sealed
 * credentials, derived JSON, stays a named behavioural method on `Db`.
 *
 * Adding a table costs one `DbTableMap` entry + one `DB_TABLE_SPECS` row
 * (plus a store binding in the mock), not three hand-written methods.
 */
export interface DbTableMap {
  entities: {
    row: Entity;
    insert: EntityInput & { organizationId: string };
    update: Partial<Pick<Entity, "name" | "description">>;
  };
  /**
   * Append-only consent evidence. `update` and `delete` exist on the accessor
   * because every mapped table shares the five operations, but nothing should
   * call them here, rewriting an audit log destroys the thing that makes it
   * evidence. A withdrawal is a new row, so `update` is deliberately `never`.
   */
  cookieConsentRecords: {
    row: CookieConsentRecord;
    insert: {
      consentId: string;
      revision: number;
      acceptedCategories: string[];
      rejectedCategories: string[];
      acceptType: string;
      action: string;
      consentedAt?: string | null;
      pageUrl?: string;
      userAgent?: string;
    };
    update: never;
  };
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
  /**
   * AI Teammates (#768). Mechanical by construction: the persona and the
   * Knowledge Scope are plain columns, and a soft delete is a patch on
   * `deletedAt`, so nothing here needs a behavioural method. The rules about
   * who may write which patch live in the operations layer, not in the seam.
   */
  teammates: {
    row: Teammate;
    insert: TeammateInput;
    update: TeammatePatch | TeammateGovernancePatch;
  };
  /**
   * Projects (#771). Mechanical: three plain columns and a flag, and archiving
   * is a patch on one of them. What is *not* here is the Project's document,
   * which lives in `memory_documents` with the other two layers, because a
   * document with history and a size cap is not a mechanical column.
   */
  projects: {
    row: Project;
    insert: ProjectInput;
    update: ProjectPatch;
  };
  /**
   * Routines (#772). The CRUD half is mechanical; what is NOT here is claiming
   * a due routine and recording its outcome, because both carry semantics the
   * generic accessor has no way to express (a compare-and-set lease, and a
   * write that must not clobber a concurrent edit to the instruction).
   */
  teammateRoutines: {
    row: TeammateRoutine;
    insert: TeammateRoutineInput;
    update: TeammateRoutinePatch;
  };
  /**
   * Teammate action grants (#770). The row *is* the grant, so the table has no
   * mutable state at all: `update` is `never`, and revoking is a delete. That
   * makes it mechanical in the strictest sense, two ids and a closed-vocabulary
   * string, which is exactly what this accessor is for.
   */
  teammateGrants: {
    row: TeammateGrant;
    insert: {
      organizationId: string;
      teammateId: string;
      domain: TeammateGrantDomain;
      grantedBy?: string | null;
    };
    update: never;
  };
  /**
   * Per-Member roster hiding (#767, story 10). Same shape as a grant row and
   * for the same reason: the row is the fact, so there is nothing to update and
   * unhiding is a delete.
   */
  teammateRosterHidden: {
    row: TeammateRosterHidden;
    insert: {
      organizationId: string;
      teammateId: string;
      userId: string;
    };
    update: never;
  };
  /**
   * Teammate channels (#778). Mechanical: a name, a bound Project and a
   * creator. What is NOT here is the transcript, because appending to it has
   * semantics the generic accessor cannot express (a strictly increasing
   * per-channel order, so two messages written in the same millisecond still
   * read back in the order they were written).
   */
  teammateChannels: {
    row: TeammateChannel;
    insert: TeammateChannelInput;
    update: TeammateChannelPatch;
  };
  /**
   * A seat in a channel: a Member or a Teammate, never both. The only mutable
   * column is a Member's own read marker, which is why `update` is that one
   * field and nothing else, adding somebody is an insert and removing them is a
   * delete.
   */
  teammateChannelParticipants: {
    row: TeammateChannelParticipant;
    insert: TeammateChannelParticipantInput;
    update: Partial<Pick<TeammateChannelParticipant, "lastReadAt">>;
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
  /**
   * Standing goals have mechanical list/update/delete semantics. Creation
   * stays behind `createAssistantGoal`, which enforces the per-Assistant cap;
   * its final insert still uses this accessor so row defaults cannot drift.
   */
  assistantGoals: {
    row: AssistantGoal;
    insert: {
      organizationId: string;
      assistantId: string;
      question: string;
      expectations: GoalExpectations;
    };
    update: Partial<Pick<AssistantGoal, "question" | "expectations" | "status">>;
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
  entities: {
    table: "entities",
    id: "shortId",
    defaults: { description: "", identityAttribute: null },
    orderBy: "createdAt",
    ascending: true,
    touchesUpdatedAt: true,
  },
  cookieConsentRecords: {
    table: "cookie_consent_records",
    id: "uuid",
    defaults: {
      acceptedCategories: [],
      rejectedCategories: [],
      consentedAt: null,
      pageUrl: "",
      userAgent: "",
    },
    // Newest first: the question asked of this table is always "what is the
    // latest decision", not "what was the first".
    orderBy: "createdAt",
    ascending: false,
    touchesUpdatedAt: false,
  },
  skills: {
    table: "skills",
    id: "shortId",
    defaults: { description: "" },
    orderBy: "createdAt",
    ascending: true,
    touchesUpdatedAt: true,
  },
  teammates: {
    table: "teammates",
    id: "shortId",
    defaults: {
      title: "",
      roleDescription: "",
      avatarSeed: "",
      visibility: "org",
      collectionIds: [],
      sourceIds: [],
      editorIds: [],
      modelProvider: "anthropic",
      modelId: "claude-opus-4-8",
      capabilityCeiling: "edit",
      approvalBypass: false,
      projectId: null,
      deletedAt: null,
    },
    orderBy: "createdAt",
    ascending: true,
    touchesUpdatedAt: true,
  },
  projects: {
    table: "projects",
    id: "shortId",
    defaults: { description: "", archived: false, createdBy: null },
    orderBy: "createdAt",
    ascending: true,
    touchesUpdatedAt: true,
  },
  teammateRoutines: {
    table: "teammate_routines",
    id: "shortId",
    defaults: {
      hour: 8,
      enabled: true,
      createdBy: null,
      lastRunAt: null,
      lastStatus: null,
      lastDetail: "",
    },
    orderBy: "createdAt",
    ascending: true,
    touchesUpdatedAt: true,
  },
  teammateGrants: {
    table: "teammate_grants",
    id: "shortId",
    defaults: { grantedBy: null },
    // Oldest first: the grants list reads as the order an admin built it in.
    orderBy: "createdAt",
    ascending: true,
    touchesUpdatedAt: false,
  },
  teammateRosterHidden: {
    table: "teammate_roster_hidden",
    id: "shortId",
    defaults: {},
    orderBy: "createdAt",
    ascending: true,
    touchesUpdatedAt: false,
  },
  teammateChannels: {
    table: "teammate_channels",
    id: "shortId",
    defaults: { projectId: null, createdBy: null },
    orderBy: "createdAt",
    ascending: true,
    touchesUpdatedAt: true,
  },
  teammateChannelParticipants: {
    table: "teammate_channel_participants",
    id: "shortId",
    defaults: {
      userId: null,
      teammateId: null,
      addedBy: null,
      lastReadAt: null,
    },
    // Oldest first: the roster reads as the order the channel was built in.
    orderBy: "createdAt",
    ascending: true,
    touchesUpdatedAt: false,
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
  assistantGoals: {
    table: "assistant_goals",
    id: "shortId",
    defaults: {
      status: "active",
      lastRunAt: null,
      lastResult: null,
      lastDetail: null,
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

/** organizationId → organization_id. Mechanical by construction, tables
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
