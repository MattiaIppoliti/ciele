import { z } from "zod";
import type {
  Assistant,
  Entity,
  EntityAttribute,
  EntityInput,
  EntityRecordValue,
  Memory,
} from "@agent-hub/core";
import type { Db } from "@agent-hub/db";
import { OperationError, defineOperation } from "./operation";

const attributeSchema = z.object({
  key: z.string().min(1).max(100),
  label: z.string().min(1).max(200),
  type: z.enum(["text", "number", "date", "boolean"]),
});

export const entityInputSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  attributes: z.array(attributeSchema).min(1).max(100),
  keyAttribute: z.string().min(1).max(100),
  scope: z.enum(["shared", "user"]),
  identityAttribute: z.string().max(100).nullable().optional(),
}) satisfies z.ZodType<EntityInput>;

export const entityPatchSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).optional(),
});

const idSchema = z.object({ id: z.string().min(1) });
const entityIdSchema = z.object({ entityId: z.string().min(1) });

async function requireEntity(
  ctx: { organizationId: string; db: Db },
  id: string
): Promise<Entity> {
  const entity = await ctx.db.table("entities").get(id);
  if (!entity || entity.organizationId !== ctx.organizationId) {
    throw new OperationError("not_found", "Entity not found");
  }
  return entity;
}

async function requireAssistant(
  ctx: { organizationId: string; db: { getAssistant(id: string): Promise<Assistant | null> } },
  id: string
): Promise<Assistant> {
  const assistant = await ctx.db.getAssistant(id);
  if (!assistant || assistant.organizationId !== ctx.organizationId) {
    throw new OperationError("not_found", "Assistant not found");
  }
  return assistant;
}

export const getAssistantEntitiesOp = defineOperation({
  name: "assistants.entities.get",
  capability: "member",
  input: z.object({ assistantId: z.string().min(1) }),
  entities: () => [],
  run: async (ctx, { assistantId }) => {
    const assistant = await requireAssistant(ctx, assistantId);
    return { entityIds: assistant.tools.entities ?? [] };
  },
});

export const setAssistantEntitiesOp = defineOperation({
  name: "assistants.entities.set",
  capability: "edit",
  input: z.object({
    assistantId: z.string().min(1),
    entityIds: z.array(z.string().min(1)).max(100),
  }),
  entities: ({ assistantId }) => [
    { kind: "assistantEditor" as const, assistantId },
  ],
  run: async (ctx, { assistantId, entityIds }) => {
    const assistant = await requireAssistant(ctx, assistantId);
    const uniqueIds = [...new Set(entityIds)];
    const owned = new Set(
      (await ctx.db.table("entities").list({ organizationId: ctx.organizationId })).map(
        (entity) => entity.id
      )
    );
    if (uniqueIds.some((id) => !owned.has(id))) {
      throw new OperationError("invalid_input", "Every Entity must belong to this Organization");
    }
    await ctx.db.updateAssistant(assistantId, {
      tools: { ...assistant.tools, entities: uniqueIds },
    });
    return { entityIds: uniqueIds };
  },
});

const IDENTITY_CLAIM_PATTERN = /^[a-zA-Z0-9_.:-]{1,64}$/;

export const getSsoIdentityOp = defineOperation({
  name: "sso.identity.get",
  capability: "manageMembers",
  input: z.object({}),
  entities: () => [],
  run: async (ctx) => {
    const connection = await ctx.db.getSsoConnection(ctx.organizationId);
    return connection
      ? {
          connected: true as const,
          provider: connection.provider,
          identityClaim: connection.config.identityClaim ?? null,
          validationStatus: connection.validationStatus,
        }
      : { connected: false as const };
  },
});

export const setSsoIdentityOp = defineOperation({
  name: "sso.identity.set",
  capability: "manageMembers",
  input: z.object({ identityClaim: z.string().nullable() }),
  entities: () => [{ kind: "aiSettings" as const }],
  run: async (ctx, { identityClaim }) => {
    const connection = await ctx.db.getSsoConnection(ctx.organizationId);
    if (!connection) throw new OperationError("not_found", "SSO connection not found");
    const claim = identityClaim?.trim() || null;
    if (claim && !IDENTITY_CLAIM_PATTERN.test(claim)) {
      throw new OperationError("invalid_input", "Identity claim name is invalid");
    }
    const { identityClaim: _identityClaim, ...baseConfig } = connection.config;
    await ctx.db.setSsoConnection(ctx.organizationId, {
      provider: connection.provider,
      config: claim ? { ...baseConfig, identityClaim: claim } : baseConfig,
      encryptedSecret: connection.encryptedSecret,
    });
    return { identityClaim: claim };
  },
});

export const validateSsoIdentityOp = defineOperation({
  name: "sso.identity.validate",
  capability: "manageMembers",
  input: z.object({}),
  entities: () => [{ kind: "aiSettings" as const }],
  run: async (ctx) => {
    const connection = await ctx.db.getSsoConnection(ctx.organizationId);
    if (!connection) throw new OperationError("not_found", "SSO connection not found");
    if (!ctx.ports?.validateSsoConnection) {
      throw new OperationError("invalid_input", "SSO validation is unavailable");
    }
    const result = await ctx.ports.validateSsoConnection(connection);
    await ctx.db.setSsoConnectionValidation(
      ctx.organizationId,
      result.ok ? "valid" : "invalid"
    );
    return result;
  },
});

function validateEntityInput(input: EntityInput): EntityInput {
  const name = input.name.trim();
  const attributes = input.attributes.map((a) => ({
    ...a,
    key: a.key.trim(),
    label: a.label.trim() || a.key.trim(),
  }));
  const keyAttribute = input.keyAttribute.trim();
  const identityAttribute = input.identityAttribute?.trim() || null;
  if (!name) {
    throw new OperationError("invalid_input", "Entity name cannot be blank");
  }
  if (attributes.some((attribute) => !attribute.key)) {
    throw new OperationError("invalid_input", "Attribute keys cannot be blank");
  }
  if (new Set(attributes.map((a) => a.key.toLowerCase())).size !== attributes.length) {
    throw new OperationError("invalid_input", "Attribute keys must be unique");
  }
  if (!attributes.some((a) => a.key === keyAttribute)) {
    throw new OperationError("invalid_input", "keyAttribute must name an attribute");
  }
  if (input.scope === "user" && !attributes.some((a) => a.key === identityAttribute)) {
    throw new OperationError("invalid_input", "User-scoped Entities require a valid identityAttribute");
  }
  return {
    ...input,
    name,
    description: input.description?.trim(),
    attributes,
    keyAttribute,
    identityAttribute: input.scope === "user" ? identityAttribute : null,
  };
}

export const listEntitiesOp = defineOperation({
  name: "entities.list",
  capability: "member",
  input: z.object({}),
  entities: () => [],
  run: (ctx) => ctx.db.table("entities").list({ organizationId: ctx.organizationId }),
});

export const getEntityOp = defineOperation({
  name: "entities.get",
  capability: "member",
  input: idSchema,
  entities: () => [],
  run: (ctx, { id }) => requireEntity(ctx, id),
});

export const createEntityOp = defineOperation({
  name: "entities.create",
  capability: "edit",
  input: entityInputSchema,
  entities: () => [{ kind: "dataEntities" as const }],
  run: (ctx, input) =>
    ctx.db.table("entities").insert({
      ...validateEntityInput(input),
      organizationId: ctx.organizationId,
    }),
});

export const updateEntityOp = defineOperation({
  name: "entities.update",
  capability: "edit",
  input: z.object({ id: z.string().min(1), patch: entityPatchSchema }),
  entities: () => [{ kind: "dataEntities" as const }],
  run: async (ctx, { id, patch }) => {
    await requireEntity(ctx, id);
    const name = patch.name?.trim();
    if (patch.name !== undefined && !name) {
      throw new OperationError("invalid_input", "Entity name cannot be blank");
    }
    return ctx.db.table("entities").update(id, {
      ...(name !== undefined ? { name } : {}),
      ...(patch.description !== undefined
        ? { description: patch.description.trim() }
        : {}),
    });
  },
});

export const deleteEntityOp = defineOperation({
  name: "entities.delete",
  capability: "edit",
  input: idSchema,
  entities: () => [{ kind: "dataEntities" as const }],
  run: async (ctx, { id }) => {
    await requireEntity(ctx, id);
    await ctx.db.table("entities").delete(id);
  },
});

export const listEntityRecordsOp = defineOperation({
  name: "entities.records.list",
  capability: "member",
  input: entityIdSchema.extend({
    limit: z.number().int().min(1).max(100).optional(),
    offset: z.number().int().min(0).optional(),
  }),
  entities: () => [],
  run: async (ctx, { entityId, limit, offset }) => {
    await requireEntity(ctx, entityId);
    const [data, total] = await Promise.all([
      ctx.db.listEntityRecords(entityId, { limit, offset }),
      ctx.db.countEntityRecords(entityId),
    ]);
    return { data, total };
  },
});

const recordValue = z.union([z.string(), z.number(), z.boolean(), z.null()]);
export const entityRecordQuerySchema = z.object({
  filters: z.record(z.string(), recordValue).optional(),
  search: z.string().max(1000).optional(),
  limit: z.number().int().min(1).max(100).optional(),
});

export const queryEntityRecordsOp = defineOperation({
  name: "entities.records.query",
  capability: "member",
  input: z.object({ entityId: z.string().min(1), query: entityRecordQuerySchema }),
  entities: () => [],
  run: async (ctx, { entityId, query }) => {
    await requireEntity(ctx, entityId);
    return { data: await ctx.db.queryEntityRecords(entityId, query) };
  },
});

function parseCsv(text: string): string[][] {
  const records: string[][] = [];
  let field = "";
  let row: string[] = [];
  let quoted = false;
  const push = () => { row.push(field); field = ""; };
  const end = () => { push(); if (row.some((v) => v.trim())) records.push(row); row = []; };
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted && char === '"' && text[i + 1] === '"') { field += '"'; i++; }
    else if (char === '"') quoted = !quoted;
    else if (!quoted && char === ",") push();
    else if (!quoted && (char === "\n" || char === "\r")) {
      if (char === "\r" && text[i + 1] === "\n") i++;
      end();
    } else field += char;
  }
  if (field || row.length) end();
  return records;
}

export const ENTITY_CSV_MAX_BYTES = 10 * 1024 * 1024;
export const ENTITY_IMPORT_MAX_ROWS = 5000;

export interface EntityCsvResult {
  rows: Array<{ key: string; values: Record<string, EntityRecordValue> }>;
  rejected: string[];
}

function parseCell(raw: string, attribute: EntityAttribute): EntityRecordValue | Error {
  const value = raw.trim();
  if (!value) return null;
  if (value.length > 4000) return new Error(`${attribute.key} exceeds 4000 characters`);
  if (attribute.type === "text") return value;
  if (attribute.type === "number") {
    const number = Number(value);
    return Number.isFinite(number)
      ? number
      : new Error(`${attribute.key} is not a number: "${value}"`);
  }
  if (attribute.type === "date") {
    return Number.isNaN(Date.parse(value))
      ? new Error(`${attribute.key} is not a date: "${value}"`)
      : value;
  }
  const normalized = value.toLowerCase();
  if (["true", "yes", "1"].includes(normalized)) return true;
  if (["false", "no", "0"].includes(normalized)) return false;
  return new Error(`${attribute.key} is not true/false: "${value}"`);
}

export function parseEntityCsv(
  text: string,
  entity: Pick<Entity, "attributes" | "keyAttribute">
): EntityCsvResult {
  if (new TextEncoder().encode(text).length > ENTITY_CSV_MAX_BYTES) {
    return { rows: [], rejected: ["file exceeds the 10MB limit"] };
  }
  const [headers, ...records] = parseCsv(text);
  if (!headers) return { rows: [], rejected: ["the file is empty"] };
  const columns = headers.map((header) => {
    const wanted = header.trim().toLowerCase();
    return entity.attributes.find((a) => a.key.toLowerCase() === wanted) ??
      entity.attributes.find((a) => a.label.trim().toLowerCase() === wanted) ?? null;
  });
  const unknown = headers.filter((_, index) => !columns[index]);
  if (unknown.length) {
    return {
      rows: [],
      rejected: [
        `unknown column${unknown.length > 1 ? "s" : ""}: ${unknown
          .map((header) => `"${header.trim()}"`)
          .join(", ")}`,
      ],
    };
  }
  if (!columns.some((a) => a?.key === entity.keyAttribute)) {
    return { rows: [], rejected: [`missing the key column "${entity.keyAttribute}"`] };
  }
  const rows: Array<{ key: string; values: Record<string, EntityRecordValue> }> = [];
  const rejected: string[] = [];
  const seen = new Set<string>();
  for (const [index, record] of records.entries()) {
    if (rows.length >= ENTITY_IMPORT_MAX_ROWS) { rejected.push(`row ${index + 2} and beyond: import capped at ${ENTITY_IMPORT_MAX_ROWS} rows`); break; }
    const values: Record<string, EntityRecordValue> = {};
    let rowError: string | null = null;
    columns.forEach((attribute, column) => {
      if (!attribute || rowError) return;
      const parsed = parseCell(record[column] ?? "", attribute);
      if (parsed instanceof Error) rowError = parsed.message;
      else values[attribute.key] = parsed;
    });
    const keyValue = values[entity.keyAttribute];
    const key = keyValue == null ? "" : String(keyValue);
    if (rowError) rejected.push(`row ${index + 2}: ${rowError}`);
    else if (!key) rejected.push(`row ${index + 2}: empty key value ("${entity.keyAttribute}")`);
    else if (seen.has(key)) rejected.push(`row ${index + 2}: duplicate key "${key}" (first one wins)`);
    else { seen.add(key); rows.push({ key, values }); }
  }
  return { rows, rejected };
}

export const importEntityRecordsOp = defineOperation({
  name: "entities.records.import",
  capability: "edit",
  input: z.object({ entityId: z.string().min(1), csv: z.string() }),
  entities: () => [{ kind: "dataEntities" as const }],
  run: async (ctx, { entityId, csv }) => {
    const entity = await requireEntity(ctx, entityId);
    const parsed = parseEntityCsv(csv, entity);
    const upserted = parsed.rows.length
      ? await ctx.db.upsertEntityRecords(entityId, parsed.rows)
      : 0;
    return { upserted, rejected: parsed.rejected };
  },
});

export const getMemorySettingsOp = defineOperation({
  name: "memories.settings.get", capability: "member", input: z.object({}), entities: () => [],
  run: async (ctx) => ({ enabled: await ctx.db.getMemoryEnabled(ctx.organizationId) }),
});
export const setMemorySettingsOp = defineOperation({
  name: "memories.settings.set", capability: "manageMembers", input: z.object({ enabled: z.boolean() }),
  entities: () => [{ kind: "aiSettings" as const }],
  run: async (ctx, { enabled }) => { await ctx.db.setMemoryEnabled(ctx.organizationId, enabled); return { enabled }; },
});
export const listMemorySubjectsOp = defineOperation({
  name: "memories.subjects.list", capability: "member", input: z.object({}), entities: () => [],
  run: (ctx) => ctx.db.listMemorySubjects(ctx.organizationId),
});
export const listSubjectMemoriesOp = defineOperation({
  name: "memories.subject.list", capability: "member", input: z.object({ subjectId: z.string().min(1) }), entities: () => [],
  run: (ctx, { subjectId }) =>
    ctx.db.listMemories({ organizationId: ctx.organizationId, subjectId }),
});
async function requireMemory(ctx: Parameters<typeof listMemorySubjectsOp.run>[0], id: string): Promise<Memory> {
  const memory = await ctx.db.getMemory(id);
  if (memory?.organizationId === ctx.organizationId) return memory;
  throw new OperationError("not_found", "Memory not found");
}
export const deleteMemoryOp = defineOperation({
  name: "memories.delete", capability: "edit", input: idSchema, entities: () => [{ kind: "aiSettings" as const }],
  run: async (ctx, { id }) => { await requireMemory(ctx, id); await ctx.db.deleteMemory(id); },
});
export const wipeSubjectMemoriesOp = defineOperation({
  name: "memories.subject.wipe", capability: "edit", input: z.object({ subjectId: z.string().min(1) }), entities: () => [{ kind: "aiSettings" as const }],
  run: async (ctx, { subjectId }) =>
    ctx.db.deleteSubjectMemories({ organizationId: ctx.organizationId, subjectId }),
});
