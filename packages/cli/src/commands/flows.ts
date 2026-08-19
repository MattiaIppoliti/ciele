import { readFileSync } from "node:fs";
import type { FlowInput, FlowPatch } from "@agent-hub/core";
import { EXIT } from "../index.ts";
import { table } from "../output.ts";
import { str, usage, type CommandContext } from "./shared.ts";

/**
 * `ciele flows …` (#628). Scalars come as flags; the full router config
 * (trigger, conditions, actions) is richer than flags can carry, so
 * create/update also accept `--file flow.json` with a FlowInput/FlowPatch
 * body, flags win over file fields when both are given.
 */

const FLOW_COLUMNS = [
  { key: "id", header: "Id" },
  { key: "name", header: "Name" },
  { key: "enabled", header: "Enabled" },
  { key: "trigger", header: "Trigger" },
  { key: "isDefault", header: "Default" },
  { key: "position", header: "Pos" },
];

function fromFileAndFlags(ctx: CommandContext): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  const file = str(ctx.flags.file);
  if (file) Object.assign(body, JSON.parse(readFileSync(file, "utf8")));
  const name = str(ctx.flags.name);
  const description = str(ctx.flags.description);
  const enabled = str(ctx.flags.enabled);
  if (name !== undefined) body.name = name;
  if (description !== undefined) body.description = description;
  if (enabled !== undefined) body.enabled = enabled === "true";
  return body;
}

export async function flows(
  verb: string | undefined,
  ctx: CommandContext
): Promise<number> {
  const { client, rest, flags, emit, deps } = ctx;
  switch (verb) {
    case "list": {
      if (!rest[0]) return usage(deps, "flows list <assistantId>");
      const { data } = await client.flows.list(rest[0]);
      emit(table(data, FLOW_COLUMNS), { data });
      return EXIT.ok;
    }
    case "get": {
      if (!rest[0]) return usage(deps, "flows get <id>");
      const flow = await client.flows.get(rest[0]);
      // The full router config is only legible as JSON.
      emit(JSON.stringify(flow, null, 2), flow);
      return EXIT.ok;
    }
    case "create": {
      if (!rest[0]) {
        return usage(deps, "flows create <assistantId> --name <n> [--file flow.json]");
      }
      const body = fromFileAndFlags(ctx);
      if (typeof body.name !== "string" || !body.name) {
        return usage(deps, "flows create: --name (or a file with name) is required");
      }
      const created = await client.flows.create(
        rest[0],
        body as unknown as FlowInput
      );
      emit(`Created flow ${created.id} ("${created.name}")`, created);
      return EXIT.ok;
    }
    case "update": {
      if (!rest[0]) {
        return usage(deps, "flows update <id> [--name|--description|--enabled|--file]");
      }
      const patch = fromFileAndFlags(ctx);
      if (Object.keys(patch).length === 0) {
        return usage(deps, "flows update: nothing to change");
      }
      const updated = await client.flows.update(rest[0], patch as FlowPatch);
      emit(`Updated flow ${updated.id}`, updated);
      return EXIT.ok;
    }
    case "delete": {
      if (!rest[0]) return usage(deps, "flows delete <id> --yes");
      if (flags.yes !== true) {
        deps.stderr("Deleting a flow is permanent. Re-run with --yes.");
        return EXIT.usage;
      }
      await client.flows.delete(rest[0]);
      emit(`Deleted flow ${rest[0]}`, { deleted: rest[0] });
      return EXIT.ok;
    }
    case "reorder": {
      const ids = str(flags.ids);
      if (!rest[0] || !ids) {
        return usage(deps, "flows reorder <assistantId> --ids <id,id,…>");
      }
      const { data } = await client.flows.reorder(rest[0], ids.split(","));
      emit(table(data, FLOW_COLUMNS), { data });
      return EXIT.ok;
    }
    default:
      return usage(deps, "flows <list|get|create|update|delete|reorder>");
  }
}
