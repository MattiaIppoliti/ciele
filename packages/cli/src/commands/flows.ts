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
    case "catalog": {
      // No assistant, no flow: what this deployment's router accepts.
      const catalog = await client.flows.catalog();
      emit(
        [
          `Triggers: ${catalog.triggers.map((t) => t.trigger).join(", ")}`,
          `Actions:  ${catalog.actions.join(", ")}`,
          `Conditions: ${catalog.conditionKinds.join(", ")} (logic: ${catalog.conditionLogic.join("/")})`,
          "",
          ...catalog.triggers.map(
            (t) => `  ${t.trigger} → ${t.allowedActions.join(", ")}`
          ),
        ].join("\n"),
        catalog
      );
      return EXIT.ok;
    }
    case "draft": {
      // Checks a patch without storing it. The point is not validation for its
      // own sake: this is the only way to see the human-review action the
      // runtime inserts ahead of a Connector write before you save one.
      const file = str(flags.file);
      const summary = str(flags.summary);
      if (!file || !summary) {
        return usage(deps, 'flows draft --file <patch.json> --summary <text> [--trigger <t>]');
      }
      const result = await client.flows.draft({
        summary,
        currentTrigger: str(flags.trigger),
        patch: JSON.parse(readFileSync(file, "utf8")),
      });
      emit(JSON.stringify(result.patch, null, 2), result);
      return EXIT.ok;
    }
    case "validate": {
      const file = str(flags.file);
      const rationale = str(flags.rationale);
      if (!rest[0] || !file || !rationale) {
        return usage(
          deps,
          "flows validate <assistantId> --file <flow.json> --rationale <text>"
        );
      }
      const result = await client.flows.validate(rest[0], {
        rationale,
        flow: JSON.parse(readFileSync(file, "utf8")),
      });
      emit(JSON.stringify(result.proposal, null, 2), result);
      return EXIT.ok;
    }
    case "runs": {
      if (!rest[0]) return usage(deps, "flows runs <flowId> [--limit <n>]");
      const result = await client.flows.runs(
        rest[0],
        flags.limit === undefined ? undefined : Number(flags.limit)
      );
      emit(
        // "which action failed" is what an operator opens this for, so it gets
        // a column rather than living in the JSON only.
        table(result.data, [
          { key: "createdAt", header: "When" },
          { key: "method", header: "Method" },
          { key: "status", header: "Status" },
          { key: "durationMs", header: "ms" },
          { key: "failedAction", header: "Failed at" },
        ]),
        result
      );
      return EXIT.ok;
    }
    case "agent-thread": {
      if (!rest[0]) {
        return usage(deps, "flows agent-thread <assistantId> [--flow <flowId>]");
      }
      const result = await client.flows.agentThread(rest[0], str(flags.flow));
      emit(
        table(result.data, [
          { key: "id", header: "ID" },
          { key: "createdAt", header: "Started" },
        ]),
        result
      );
      return EXIT.ok;
    }
    case "agent-conversation": {
      const conversation = str(flags.conversation);
      if (!rest[0] || !conversation) {
        return usage(
          deps,
          "flows agent-conversation <assistantId> --conversation <conversationId>"
        );
      }
      const view = await client.flows.agentConversation(rest[0], conversation);
      emit(JSON.stringify(view, null, 2), view);
      return EXIT.ok;
    }
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
      return usage(deps, "flows <catalog|list|get|create|draft|validate|runs|agent-thread|agent-conversation|update|delete|reorder>");
  }
}
