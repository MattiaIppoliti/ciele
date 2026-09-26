import { z } from "zod";
import type { ApplicationImport, ApplicationProvider } from "@agent-hub/core";
import {
  normalizeApplicationImportConfig,
  validateApplicationImportScopes,
} from "./application-import-config";
import type { MutatedEntity } from "./entities";
import { OperationError, defineOperation, type OperationContext } from "./operation";

/**
 * The Application Import lifecycle: create, edit, retarget, pause, sync and
 * delete a configured import of an Application Connection's content into the
 * Library. These rules used to live only in server actions, untested; the
 * provider discovery and the sync queue they need are the host's, behind
 * `ports.applicationImports`.
 */

/** Every lifecycle result names the Assistants whose Knowledge tab it touched. */
interface Touched {
  assistantIds: string[];
}

/** The Library, plus the Knowledge tab of each Assistant an Import feeds. */
function touched(result: Touched): MutatedEntity[] {
  return [
    { kind: "knowledgeHub" },
    ...[...new Set(result.assistantIds)].map((assistantId) => ({
      kind: "assistantEditor" as const,
      assistantId,
    })),
  ];
}

function requirePort(ctx: OperationContext) {
  const port = ctx.ports?.applicationImports;
  if (!port) {
    throw new OperationError(
      "invalid_input",
      "Application Imports are not available on this surface"
    );
  }
  return port;
}

async function requireConnection(ctx: OperationContext, connectionId: string) {
  const connection = await ctx.db.getSafeApplicationConnection(connectionId);
  if (!connection || connection.organizationId !== ctx.organizationId) {
    throw new OperationError("not_found", "Application Connection not found");
  }
  return connection;
}

async function requireImport(ctx: OperationContext, importId: string) {
  const applicationImport = await ctx.db.getApplicationImport(importId);
  if (!applicationImport || applicationImport.organizationId !== ctx.organizationId) {
    throw new OperationError("not_found", "Application Import not found");
  }
  return applicationImport;
}

/** An Import feeds at least one Assistant, and only this Organization's. */
async function requireOwnedAssistantIds(ctx: OperationContext, requested: string[]) {
  const assistantIds = [...new Set(requested)];
  if (assistantIds.length === 0) {
    throw new OperationError("invalid_input", "Select at least one Assistant");
  }
  const allowed = new Set(
    (await ctx.db.listAssistants(ctx.organizationId)).map((assistant) => assistant.id)
  );
  if (assistantIds.some((id) => !allowed.has(id))) {
    throw new OperationError(
      "invalid_input",
      "One or more Assistants do not belong to this Organization"
    );
  }
  return assistantIds;
}

/** The configuration as stored: normalized, then checked against discovery. */
async function validatedConfig(
  ctx: OperationContext,
  connection: { id: string; provider: ApplicationProvider },
  raw: Record<string, unknown>
) {
  const scopes = await requirePort(ctx).discoverScopes(connection.id);
  try {
    return validateApplicationImportScopes(
      connection.provider,
      normalizeApplicationImportConfig(connection.provider, raw),
      scopes
    );
  } catch (error) {
    // The normaliser speaks plain Errors; to a caller they are bad input,
    // with the message ("Invite Ciele to #x first") being the whole answer.
    throw new OperationError(
      "invalid_input",
      error instanceof Error ? error.message : "Invalid Import configuration"
    );
  }
}

/**
 * What the Import reads, and nothing about how: two configurations with the
 * same signature import the same corpus, so editing only the name, cadence or
 * a history window keeps what was already imported.
 */
export function applicationScopeSignature(
  provider: ApplicationProvider,
  config: Record<string, unknown>
): string {
  const ids = (key: string) =>
    (Array.isArray(config[key]) ? config[key] : []).map(String).sort();
  if (provider === "slack") return JSON.stringify(ids("channelIds"));
  if (provider === "servicenow") return JSON.stringify(ids("knowledgeBaseIds"));
  if (provider === "salesforce") {
    return JSON.stringify({
      language: String(config.language ?? "en_US"),
      categories: ids("dataCategories"),
    });
  }
  return JSON.stringify({
    scopeId: String(config.scopeId ?? ""),
    driveId: String(config.driveId ?? ""),
    folderId: String(config.folderId ?? ""),
  });
}

/** Trimmed here, not in the schema: `run` is also called without parsing. */
function importName(raw: string): string {
  const value = raw.trim();
  if (!value) throw new OperationError("invalid_input", "Name is required");
  if (value.length > 2000) throw new OperationError("invalid_input", "Name is too long");
  return value;
}

const configuration = z.object({
  name: z.string(),
  assistantIds: z.array(z.string().min(1)),
  cadence: z.enum(["manual", "daily"]),
  config: z.record(z.string(), z.unknown()),
});

export const createApplicationImportOp = defineOperation({
  name: "applications.imports.create",
  capability: "edit",
  input: configuration.extend({ connectionId: z.string().min(1) }),
  entities: (_input, result: Touched & { id: string }) => touched(result),
  run: async (ctx, input): Promise<Touched & { id: string }> => {
    const connection = await requireConnection(ctx, input.connectionId);
    const assistantIds = await requireOwnedAssistantIds(ctx, input.assistantIds);
    const config = await validatedConfig(ctx, connection, input.config);
    const collection = await ctx.db.getOrCreateOrgLibraryCollection(ctx.organizationId);
    const created = await ctx.db.createApplicationImport({
      organizationId: ctx.organizationId,
      connectionId: connection.id,
      collectionId: collection.id,
      name: importName(input.name),
      config,
      cadence: input.cadence,
      assistantIds,
    });
    await requirePort(ctx).enqueueSync({
      importId: created.id,
      organizationId: ctx.organizationId,
    });
    return { id: created.id, assistantIds };
  },
});

export const updateApplicationImportConfigurationOp = defineOperation({
  name: "applications.imports.configure",
  capability: "edit",
  input: configuration.extend({ importId: z.string().min(1) }),
  entities: (_input, result: Touched) => touched(result),
  run: async (ctx, input): Promise<Touched> => {
    const current = await requireImport(ctx, input.importId);
    if (current.status === "syncing") {
      throw new OperationError(
        "invalid_input",
        "Wait for the current synchronization before editing this Import"
      );
    }
    const connection = await requireConnection(ctx, current.connectionId);
    const assistantIds = await requireOwnedAssistantIds(ctx, input.assistantIds);
    const config = await validatedConfig(ctx, connection, input.config);
    await ctx.db.updateApplicationImport(input.importId, {
      name: importName(input.name),
      assistantIds,
      cadence: input.cadence,
      config,
      resetSources:
        applicationScopeSignature(connection.provider, current.config) !==
        applicationScopeSignature(connection.provider, config),
      checkpoint: {},
      status: "idle",
      error: "",
      nextSyncAt: current.enabled ? new Date().toISOString() : null,
    });
    if (current.enabled) {
      await requirePort(ctx).enqueueSync({
        importId: input.importId,
        organizationId: ctx.organizationId,
      });
    }
    // Both the Assistants it stopped feeding and the ones it feeds now.
    return { assistantIds: [...current.assistantIds, ...assistantIds] };
  },
});

/**
 * Replaces the Import's Assistant scope. The Import is the template: every
 * Source it materialized follows it, so per-Source links never become a
 * second, drifting source of truth.
 */
export const setApplicationImportAssistantsOp = defineOperation({
  name: "applications.imports.assistants.set",
  capability: "edit",
  input: z.object({ importId: z.string().min(1), assistantIds: z.array(z.string().min(1)) }),
  entities: (_input, result: Touched) => touched(result),
  run: async (ctx, input): Promise<Touched> => {
    const current = await requireImport(ctx, input.importId);
    const assistantIds = await requireOwnedAssistantIds(ctx, input.assistantIds);
    await ctx.db.updateApplicationImport(input.importId, { assistantIds });
    return { assistantIds: [...current.assistantIds, ...assistantIds] };
  },
});

/** Pausing cancels what is queued; resuming a daily Import schedules it now. */
export const setApplicationImportEnabledOp = defineOperation({
  name: "applications.imports.enabled.set",
  capability: "edit",
  input: z.object({ importId: z.string().min(1), enabled: z.boolean() }),
  entities: (_input, result: Touched) => touched(result),
  run: async (ctx, input): Promise<Touched> => {
    const current = await requireImport(ctx, input.importId);
    const port = requirePort(ctx);
    await ctx.db.updateApplicationImport(input.importId, {
      enabled: input.enabled,
      ...(input.enabled ? {} : { status: "idle" as const, error: "" }),
      nextSyncAt:
        input.enabled && current.cadence === "daily" ? new Date().toISOString() : null,
    });
    if (input.enabled) {
      await port.enqueueSync({ importId: input.importId, organizationId: ctx.organizationId });
    } else {
      await port.cancelSync(input.importId, "Application Import paused");
    }
    return { assistantIds: current.assistantIds };
  },
});

export const syncApplicationImportNowOp = defineOperation({
  name: "applications.imports.sync",
  capability: "edit",
  input: z.object({ importId: z.string().min(1) }),
  entities: (_input, result: Touched) => touched(result),
  run: async (ctx, input): Promise<Touched> => {
    const current: ApplicationImport = await requireImport(ctx, input.importId);
    if (!current.enabled) {
      throw new OperationError(
        "invalid_input",
        "Resume this Application Import before synchronizing"
      );
    }
    await requirePort(ctx).enqueueSync({
      importId: current.id,
      organizationId: ctx.organizationId,
    });
    return { assistantIds: current.assistantIds };
  },
});

/** Cancels the Import's queued syncs first, so none runs against a deleted row. */
export const deleteApplicationImportOp = defineOperation({
  name: "applications.imports.delete",
  capability: "edit",
  input: z.object({ importId: z.string().min(1) }),
  entities: (_input, result: Touched) => touched(result),
  run: async (ctx, input): Promise<Touched> => {
    const current = await requireImport(ctx, input.importId);
    await requirePort(ctx).cancelSync(input.importId, "Application Import deleted");
    await ctx.db.deleteApplicationImport(input.importId);
    return { assistantIds: current.assistantIds };
  },
});
