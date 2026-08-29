import { readFileSync } from "node:fs";
import type { EntityInput, EntityRecordQuery } from "@agent-hub/core";
import { EXIT } from "../index.ts";
import { table } from "../output.ts";
import { str, usage, type CommandContext } from "./shared.ts";

function jsonFile<T>(ctx: CommandContext, hint: string): T | number {
  const path = str(ctx.flags.file);
  if (!path) return usage(ctx.deps, hint);
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

export async function entities(verb: string | undefined, ctx: CommandContext) {
  const { client, flags, rest, emit, deps } = ctx;
  switch (verb) {
    case "list": {
      const page = await client.entities.list({
        limit: str(flags.limit) ? Number(str(flags.limit)) : undefined,
        cursor: str(flags.cursor),
      });
      emit(table(page.data, [
        { key: "id", header: "Id" },
        { key: "name", header: "Name" },
        { key: "scope", header: "Scope" },
        { key: "keyAttribute", header: "Key" },
      ]), page);
      return EXIT.ok;
    }
    case "get":
      if (!rest[0]) return usage(deps, "entities get <id>");
      return client.entities.get(rest[0]).then((entity) => {
        emit(JSON.stringify(entity, null, 2), entity);
        return EXIT.ok;
      });
    case "create": {
      const input = jsonFile<EntityInput>(ctx, "entities create --file <entity.json>");
      if (typeof input === "number") return input;
      const entity = await client.entities.create(input);
      emit(`Created ${entity.id}`, entity);
      return EXIT.ok;
    }
    case "update": {
      if (!rest[0]) return usage(deps, "entities update <id> [--name|--description]");
      const patch = { name: str(flags.name), description: str(flags.description) };
      if (patch.name === undefined && patch.description === undefined) {
        return usage(deps, "entities update <id> [--name|--description]");
      }
      const entity = await client.entities.update(rest[0], patch);
      emit(`Updated ${entity.id}`, entity);
      return EXIT.ok;
    }
    case "delete":
      if (!rest[0] || flags.yes !== true) return usage(deps, "entities delete <id> --yes");
      await client.entities.delete(rest[0]);
      emit(`Deleted ${rest[0]}`, { deleted: rest[0] });
      return EXIT.ok;
    default:
      return usage(deps, "entities <list|get|create|update|delete>");
  }
}

export async function records(verb: string | undefined, ctx: CommandContext) {
  const { client, flags, rest, emit, deps } = ctx;
  const entityId = rest[0];
  if (!entityId) return usage(deps, `records ${verb ?? "<list|query|import>"} <entityId>`);
  switch (verb) {
    case "list": {
      const result = await client.entities.listRecords(entityId, {
        limit: str(flags.limit) ? Number(str(flags.limit)) : undefined,
        offset: str(flags.offset) ? Number(str(flags.offset)) : undefined,
      });
      emit(JSON.stringify(result.data, null, 2), result);
      return EXIT.ok;
    }
    case "query": {
      const query = jsonFile<EntityRecordQuery>(ctx, "records query <entityId> --file <query.json>");
      if (typeof query === "number") return query;
      const result = await client.entities.queryRecords(entityId, query);
      emit(JSON.stringify(result.data, null, 2), result);
      return EXIT.ok;
    }
    case "import": {
      const path = str(flags.file);
      if (!path) return usage(deps, "records import <entityId> --file <records.csv>");
      const result = await client.entities.importRecords(entityId, readFileSync(path, "utf8"));
      emit(`Upserted ${result.upserted}; rejected ${result.rejected.length}`, result);
      return EXIT.ok;
    }
    default:
      return usage(deps, "records <list|query|import> <entityId>");
  }
}
