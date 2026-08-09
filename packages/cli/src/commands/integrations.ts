import { readFileSync } from "node:fs";
import type { ApiEndpointSpec, ApiIntegrationAuthType } from "@agent-hub/core";
import { EXIT } from "../index.ts";
import { table } from "../output.ts";
import { str, usage, type CommandContext } from "./shared.ts";

function jsonFile<T>(ctx: CommandContext, hint: string): T | number {
  const file = str(ctx.flags.file);
  if (!file) return usage(ctx.deps, hint);
  return JSON.parse(readFileSync(file, "utf8")) as T;
}

export async function apiIntegrations(
  verb: string | undefined,
  ctx: CommandContext
) {
  const { client, rest, flags, emit, deps } = ctx;
  switch (verb) {
    case "get": {
      if (!rest[0]) return usage(deps, "api-integrations get <assistantId>");
      const integration = await client.apiIntegrations.get(rest[0]);
      emit(JSON.stringify(integration, null, 2), integration);
      return EXIT.ok;
    }
    case "set": {
      if (!rest[0]) {
        return usage(deps, "api-integrations set <assistantId> --file <integration.json>");
      }
      const input = jsonFile<{
        name: string;
        baseUrl: string;
        authType: ApiIntegrationAuthType;
        authHeaderName?: string;
        authUsername?: string;
        credential?: string;
        endpoints: ApiEndpointSpec[];
      }>(ctx, "api-integrations set <assistantId> --file <integration.json>");
      if (typeof input === "number") return input;
      const integration = await client.apiIntegrations.set(rest[0], input);
      emit(`Saved API integration for ${rest[0]}`, integration);
      return EXIT.ok;
    }
    case "delete":
      if (!rest[0] || flags.yes !== true) {
        return usage(deps, "api-integrations delete <assistantId> --yes");
      }
      await client.apiIntegrations.delete(rest[0]);
      emit(`Deleted API integration for ${rest[0]}`, { deleted: rest[0] });
      return EXIT.ok;
    default:
      return usage(deps, "api-integrations <get|set|delete>");
  }
}

export async function providers(verb: string | undefined, ctx: CommandContext) {
  const { client, rest, flags, emit, deps } = ctx;
  switch (verb) {
    case "list": {
      const result = await client.providers.list();
      emit(table(result.data, [
        { key: "id", header: "ID" },
        { key: "displayName", header: "Name" },
        { key: "provider", header: "Provider" },
        { key: "type", header: "Type" },
        { key: "preferredForEmbedding", header: "Embedding" },
      ]), result);
      return EXIT.ok;
    }
    case "create-api-key": {
      const input = jsonFile<Parameters<typeof client.providers.createApiKey>[0]>(
        ctx,
        "providers create-api-key --file <provider.json>"
      );
      if (typeof input === "number") return input;
      const result = await client.providers.createApiKey(input);
      if (result.error) {
        deps.stderr(result.error);
        return EXIT.usage;
      }
      emit(`Created provider connection ${result.connection?.id}`, result);
      return EXIT.ok;
    }
    case "create-compatible": {
      const input = jsonFile<Parameters<typeof client.providers.createCompatible>[0]>(
        ctx,
        "providers create-compatible --file <provider.json>"
      );
      if (typeof input === "number") return input;
      const result = await client.providers.createCompatible(input);
      if (result.error) {
        deps.stderr(result.error);
        return EXIT.usage;
      }
      emit(`Created provider connection ${result.connection?.id ?? ""}`.trim(), result);
      return EXIT.ok;
    }
    case "create-federated": {
      const input = jsonFile<Record<string, unknown>>(
        ctx,
        "providers create-federated --file <provider.json>"
      );
      if (typeof input === "number") return input;
      const connection = await client.providers.createFederated(input);
      emit(`Created provider connection ${connection.id}`, connection);
      return EXIT.ok;
    }
    case "delete":
      if (!rest[0] || flags.yes !== true) return usage(deps, "providers delete <id> --yes");
      await client.providers.delete(rest[0]);
      emit(`Deleted ${rest[0]}`, { deleted: rest[0] });
      return EXIT.ok;
    case "set-embedding": {
      if (!rest[0]) return usage(deps, "providers set-embedding <connectionId|auto>");
      const connectionId = rest[0] === "auto" ? null : rest[0];
      const result = await client.providers.setEmbedding(connectionId);
      emit(connectionId ? `Embedding provider set to ${connectionId}` : "Embedding provider set to automatic", result);
      return EXIT.ok;
    }
    default:
      return usage(
        deps,
        "providers <list|create-api-key|create-compatible|create-federated|delete|set-embedding>"
      );
  }
}
