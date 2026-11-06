import { z } from "zod";
import { ASSISTANT_BUNDLE_MAX_BYTES, buildPublicationConfig, redactFlowSecrets, sortFlows, type AssistantBundle } from "@agent-hub/core";
import { assistantPatchSchema, requireAssistant } from "./assistants";
import { flowInputSchema } from "./flow-schema";
import { apiIntegrationInputSchema } from "./integrations";
import { defineOperation, OperationError, type OperationContext } from "./operation";
const portableFlow = flowInputSchema.and(z.object({ enabled: z.boolean(), builtIn: z.boolean(), isDefault: z.boolean() }));
const skill = z.object({ name: z.string().min(1).max(200), description: z.string().max(2000), prompt: z.string().max(100000), starter: z.string().max(2000).default("") });
export const assistantBundleSchema = z.object({
  bundleVersion: z.literal(1, { error: "Unsupported bundleVersion. This deployment supports version 1." }),
  assistant: assistantPatchSchema.extend({ title: z.string().min(1).max(200) }).passthrough(),
  flows: z.array(portableFlow).max(500), skills: z.array(skill).max(100),
  collections: z.array(z.string().min(1)).max(500),
  apiIntegration: apiIntegrationInputSchema.omit({ credential: true }).nullable(),
}).refine(bundle => new TextEncoder().encode(JSON.stringify(bundle)).byteLength <= ASSISTANT_BUNDLE_MAX_BYTES, "The Assistant bundle must be 5 MB or smaller") satisfies z.ZodType<AssistantBundle>;
type ReferenceKind = "desk" | "connection" | "assistant" | "schedule" | "mcp";
const referenceKeys: Record<string, ReferenceKind> = { helpDeskId: "desk", connectionId: "connection", senderConnectionId: "connection", assistantId: "assistant", businessHoursId: "schedule", serverId: "mcp" };
/** Data-only traversal: unknown future fields remain portable, sealed slots do not. */
function portableValue(value: unknown, resolve: (kind: ReferenceKind, id: string) => string | undefined): unknown {
  if (Array.isArray(value)) return value.map(item => portableValue(item, resolve));
  if (typeof value === "string" && /^https?:\/\//i.test(value)) {
    try {
      const url = new URL(value); let changed = Boolean(url.username || url.password);
      url.username = ""; url.password = "";
      for (const name of [...url.searchParams.keys()]) if (/token|secret|password|credential|authorization|signature|api.?key/i.test(name)) { url.searchParams.set(name, ""); changed = true; }
      return changed ? url.toString() : value;
    } catch { return value; }
  }
  if (!value || typeof value !== "object") return value;
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (/^encrypted/i.test(key) || ["hasToken", "hasKey", "hasPassword"].includes(key)) continue;
    if (["bearer", "api_key", "basic"].includes("type" in value ? String(value.type) : "") && ["token", "key", "password", "username"].includes(key)) continue;
    if (key === "remoteMcp" && Array.isArray(item)) {
      result[key] = item.flatMap(tool => {
        const mapped = portableValue(tool, resolve);
        return mapped && typeof mapped === "object" && "serverId" in mapped && typeof mapped.serverId === "string" ? [mapped] : [];
      });
      continue;
    }
    const kind = referenceKeys[key];
    if (kind && typeof item === "string" && item) { const mapped = resolve(kind, item); if (mapped) result[key] = mapped; }
    else result[key] = portableValue(item, resolve);
  }
  return result;
}
async function targetReferences(ctx: OperationContext) {
  const [desks, connections, assistants, schedules, servers] = await Promise.all([
    ctx.db.listHelpDesks(ctx.organizationId), ctx.db.listApplicationConnections(ctx.organizationId), ctx.db.listAssistants(ctx.organizationId),
    ctx.db.table("businessHours").list({ organizationId: ctx.organizationId }), ctx.db.table("mcpServerConnections").list({ organizationId: ctx.organizationId }),
  ]);
  return {
    desk: desks.map(row => ({ id: row.id, name: row.name })),
    connection: connections.map(row => ({ id: row.id, name: row.provider })),
    assistant: assistants.map(row => ({ id: row.id, name: row.title })),
    schedule: schedules.map(row => ({ id: row.id, name: row.name })),
    mcp: servers.map(row => ({ id: row.id, name: row.name })),
  };
}
export const exportAssistantBundleOp = defineOperation({
  name: "assistants.export", capability: "assistants:view", effect: "read", input: z.object({ assistantId: z.string().min(1) }), entities: () => [],
  run: async (ctx, { assistantId }): Promise<AssistantBundle> => {
    const assistant = await requireAssistant(ctx, assistantId);
    const [flows, collections, skills, integration, refs] = await Promise.all([
      ctx.db.listFlows(assistantId), ctx.db.listCollections(assistantId), ctx.db.listAssistantSkills(assistantId), ctx.db.getApiIntegration(assistantId), targetReferences(ctx),
    ]);
    const snapshot = buildPublicationConfig(assistant, flows, collections, skills);
    const { id: _id, organizationId: _org, ...configuration } = snapshot.assistant;
    const named = (kind: ReferenceKind, id: string) => kind === "assistant" && id === assistantId ? "@self" : refs[kind].find(row => row.id === id)?.name;
    const projected = portableValue(configuration, named);
    if (!projected || typeof projected !== "object" || Array.isArray(projected)) throw new OperationError("invalid_input", "Invalid Assistant configuration");
    const settings = configuration.helpDeskSettings;
    const portableAssistant = { ...projected, helpDeskSettings: { ...settings, ...(settings.selectedIds ? { selectedIds: settings.selectedIds.flatMap(id => named("desk", id) ?? []) } : {}) } };
    const apiIntegration = integration ? { name: integration.name, baseUrl: integration.baseUrl, authType: integration.authType, authHeaderName: integration.authHeaderName, authUsername: "", endpoints: integration.endpoints.map(endpoint => ({ ...endpoint, params: endpoint.params?.map(({ value: _value, ...param }) => param) })) } : null;
    return assistantBundleSchema.parse({ bundleVersion: 1, assistant: portableAssistant, collections: snapshot.collections.map(row => row.name), skills: snapshot.skills?.map(({ id: _skillId, ...rest }) => rest) ?? [], apiIntegration: portableValue(apiIntegration, named),
      flows: sortFlows(snapshot.flows).map(flow => {
        const redacted = redactFlowSecrets(flow);
        return { name: flow.name, description: flow.description, enabled: flow.enabled, builtIn: flow.builtIn, isDefault: flow.isDefault, trigger: flow.trigger, triggerSettings: flow.triggerSettings, conditionLogic: flow.conditionLogic, conditions: portableValue(flow.conditions, named), actions: flow.actions, actionSettings: portableValue(redacted.actionSettings, named), customMessage: flow.customMessage };
      }),
    });
  },
});
export const importAssistantBundleOp = defineOperation({
  name: "assistants.import", capability: "assistants:edit", effect: "write", input: z.object({ bundle: assistantBundleSchema }),
  entities: (_input, result: { assistantId: string; report: string[] }) => [{ kind: "assistant" as const, id: result.assistantId }, { kind: "assistantList" as const }, { kind: "knowledgeHub" as const }],
  run: async (ctx, { bundle }) => {
    const report: string[] = [];
    const refs = await targetReferences(ctx);
    const assistant = await ctx.db.createAssistant(ctx.organizationId, { title: bundle.assistant.title, nickname: bundle.assistant.nickname, description: bundle.assistant.description });
    const importedId = assistant.id;
    const resolve = (kind: ReferenceKind, name: string) => {
      if (kind === "assistant" && name === "@self") return importedId;
      const matches = refs[kind].filter(row => row.name === name);
      if (matches.length === 1) return matches[0].id;
      report.push(`${kind} "${name}": ${matches.length ? "ambiguous match" : "not found"}. Needs setup.`);
      return kind === "schedule" ? `@unresolved:${name}` : undefined;
    };
    try {
    const patch = assistantPatchSchema.parse(portableValue(bundle.assistant, resolve));
    const desks = bundle.assistant.helpDeskSettings?.selectedIds?.flatMap(name => resolve("desk", name) ?? []);
    if (desks) patch.helpDeskSettings = { ...patch.helpDeskSettings, selectedIds: desks };
      await ctx.db.updateAssistant(assistant.id, patch);
      const seeds = await ctx.db.listFlows(assistant.id);
      const consumed = new Set<string>();
      const ordered: string[] = [];
      for (const flow of bundle.flows) {
        const before = report.length;
        const source = flowInputSchema.parse(portableValue(flow, resolve));
        const unresolved = report.length > before;
        if (unresolved) report.push(`Flow "${flow.name}" is disabled until its references are configured.`);
        const settings = JSON.stringify(source.actionSettings ?? {});
        if (/"type":"(?:bearer|api_key|basic)"/.test(settings) || /"(?:headers|queryParams)":\[/.test(settings)) report.push(`Flow "${flow.name}" has outbound request fields without credentials or values. Needs setup.`);
        // Redact again on import: hand-written bundles cannot smuggle credentials.
        const safe = redactFlowSecrets(source);
        const seed = seeds.find(row => !consumed.has(row.id) && (flow.isDefault ? row.isDefault : flow.builtIn && row.builtIn && !row.isDefault && row.actions.join(",") === flow.actions?.join(",")));
        const created = seed ?? await ctx.db.createFlow(assistant.id, safe);
        if (seed) consumed.add(seed.id);
        await ctx.db.updateFlow(created.id, { ...safe, enabled: flow.enabled && !unresolved });
        if (!flow.isDefault) ordered.push(created.id);
      }
      for (const seed of seeds) if (!consumed.has(seed.id) && !seed.isDefault) await ctx.db.deleteFlow(seed.id);
      await ctx.db.reorderFlows(assistant.id, ordered);
      const skillIds: string[] = [];
      for (const item of bundle.skills) skillIds.push((await ctx.db.table("skills").insert({ ...item, organizationId: ctx.organizationId })).id);
      await ctx.db.setAssistantSkills(assistant.id, skillIds);
      const collections = await ctx.db.listOrgCollections(ctx.organizationId);
      for (const name of bundle.collections) {
        const matches = collections.filter(row => row.name === name);
        if (matches.length !== 1) { report.push(`Collection "${name}": ${matches.length ? "ambiguous match" : "not found"}.`); continue; }
        const sources = await ctx.db.listSources(matches[0].id);
        if (!sources.length) report.push(`Collection "${name}" has no readable Sources to link.`);
        for (const source of sources) await ctx.db.setSourceAssistantLinks(source.id, [...new Set([...(await ctx.db.listSourceAssistantLinks(source.id)).map(link => link.assistantId), assistant.id])]);
      }
      if (bundle.apiIntegration) {
        await ctx.db.setApiIntegration({ ...bundle.apiIntegration, assistantId: assistant.id, organizationId: ctx.organizationId, encryptedCredential: null });
        if (bundle.apiIntegration.authType !== "none") report.push(`API Integration "${bundle.apiIntegration.name}" needs credentials. Needs setup.`);
      }
      return { assistantId: assistant.id, report: [...new Set(report)] };
    } catch (error) {
      await ctx.db.deleteAssistant(assistant.id).catch(() => {});
      throw error;
    }
  },
});
