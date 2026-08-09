import { readFileSync } from "node:fs";
import type { GoalExpectations, GoalStatus, SkillInput, SkillPatch } from "@agent-hub/core";
import { EXIT } from "../index.ts";
import { table } from "../output.ts";
import { str, usage, type CommandContext } from "./shared.ts";

function jsonFile<T>(ctx: CommandContext, hint: string): T | number {
  const path = str(ctx.flags.file);
  if (!path) return usage(ctx.deps, hint);
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

export async function skills(verb: string | undefined, ctx: CommandContext) {
  const { client, rest, flags, emit, deps } = ctx;
  switch (verb) {
    case "list": {
      const result = await client.skills.list();
      emit(table(result.data, [
        { key: "id", header: "ID" },
        { key: "name", header: "Name" },
        { key: "description", header: "Description" },
      ]), result);
      return EXIT.ok;
    }
    case "create": {
      const input = jsonFile<SkillInput>(ctx, "skills create --file <skill.json>");
      if (typeof input === "number") return input;
      const skill = await client.skills.create(input);
      emit(`Created ${skill.id}`, skill);
      return EXIT.ok;
    }
    case "update": {
      if (!rest[0]) return usage(deps, "skills update <id> --file <patch.json>");
      const patch = jsonFile<SkillPatch>(ctx, "skills update <id> --file <patch.json>");
      if (typeof patch === "number") return patch;
      const skill = await client.skills.update(rest[0], patch);
      emit(`Updated ${skill.id}`, skill);
      return EXIT.ok;
    }
    case "delete":
      if (!rest[0] || flags.yes !== true) return usage(deps, "skills delete <id> --yes");
      await client.skills.delete(rest[0]);
      emit(`Deleted ${rest[0]}`, { deleted: rest[0] });
      return EXIT.ok;
    default:
      return usage(deps, "skills <list|create|update|delete>");
  }
}

export async function goals(verb: string | undefined, ctx: CommandContext) {
  const { client, rest, flags, emit, deps } = ctx;
  switch (verb) {
    case "list": {
      if (!rest[0]) return usage(deps, "goals list <assistantId>");
      const result = await client.goals.list(rest[0]);
      emit(table(result.data, [
        { key: "id", header: "ID" },
        { key: "question", header: "Question" },
        { key: "status", header: "Status" },
        { key: "lastResult", header: "Last result" },
      ]), result);
      return EXIT.ok;
    }
    case "create": {
      if (!rest[0]) return usage(deps, "goals create <assistantId> --file <goal.json>");
      const input = jsonFile<{ question: string; expectations: GoalExpectations }>(
        ctx,
        "goals create <assistantId> --file <goal.json>"
      );
      if (typeof input === "number") return input;
      const goal = await client.goals.create(rest[0], input);
      emit(`Created ${goal.id}`, goal);
      return EXIT.ok;
    }
    case "update": {
      if (!rest[0] || !rest[1]) {
        return usage(deps, "goals update <assistantId> <goalId> --file <patch.json>");
      }
      const patch = jsonFile<{
        question?: string;
        expectations?: GoalExpectations;
        status?: GoalStatus;
      }>(ctx, "goals update <assistantId> <goalId> --file <patch.json>");
      if (typeof patch === "number") return patch;
      const goal = await client.goals.update(rest[0], rest[1], patch);
      emit(`Updated ${goal.id}`, goal);
      return EXIT.ok;
    }
    case "delete":
      if (!rest[0] || !rest[1] || flags.yes !== true) {
        return usage(deps, "goals delete <assistantId> <goalId> --yes");
      }
      await client.goals.delete(rest[0], rest[1]);
      emit(`Deleted ${rest[1]}`, { deleted: rest[1] });
      return EXIT.ok;
    default:
      return usage(deps, "goals <list|create|update|delete>");
  }
}

export async function alerts(verb: string | undefined, ctx: CommandContext) {
  const { client, rest, emit, deps } = ctx;
  switch (verb) {
    case "list": {
      const result = await client.alerts.list();
      emit(table(result.data, [
        { key: "id", header: "ID" },
        { key: "type", header: "Type" },
        { key: "title", header: "Title" },
        { key: "status", header: "Status" },
      ]), result);
      return EXIT.ok;
    }
    case "resolve": {
      if (!rest[0]) return usage(deps, "alerts resolve <id>");
      const alert = await client.alerts.resolve(rest[0]);
      emit(`Resolved ${alert.id}`, alert);
      return EXIT.ok;
    }
    default:
      return usage(deps, "alerts <list|resolve>");
  }
}
