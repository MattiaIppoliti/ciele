import { readFileSync } from "node:fs";
import { EXIT } from "../index.ts";
import { table } from "../output.ts";
import { str, usage, type CommandContext } from "./shared.ts";

const ASSISTANT_COLUMNS = [
  { key: "id", header: "Id" },
  { key: "title", header: "Title" },
  { key: "nickname", header: "Nickname" },
  { key: "createdAt", header: "Created" },
];

export async function assistants(
  verb: string | undefined,
  ctx: CommandContext
): Promise<number> {
  const { client, rest, flags, emit, deps } = ctx;
  switch (verb) {
    case "list": {
      if (flags.all === true) {
        const all = [];
        for await (const a of client.assistants.listAll()) all.push(a);
        emit(table(all, ASSISTANT_COLUMNS), { data: all });
        return EXIT.ok;
      }
      const limit = str(flags.limit);
      const page = await client.assistants.list(
        limit ? { limit: Number(limit) } : {}
      );
      emit(table(page.data, ASSISTANT_COLUMNS), page);
      return EXIT.ok;
    }
    case "get": {
      if (!rest[0]) return usage(deps, "assistants get <id>");
      const assistant = await client.assistants.get(rest[0]);
      emit(table([assistant], ASSISTANT_COLUMNS), assistant);
      return EXIT.ok;
    }
    case "create": {
      const title = str(flags.title);
      if (!title) return usage(deps, "assistants create --title <title>");
      const created = await client.assistants.create({
        title,
        nickname: str(flags.nickname),
        description: str(flags.description),
      });
      emit(`Created ${created.id} ("${created.title}")`, created);
      return EXIT.ok;
    }
    case "update": {
      if (!rest[0]) return usage(deps, "assistants update <id> [--title …]");
      const file = str(flags.file);
      const patch: Record<string, unknown> = file
        ? JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>
        : {};
      for (const [flag, field] of [
        ["title", "title"],
        ["nickname", "nickname"],
        ["description", "description"],
        ["answering-style", "answeringStyle"],
      ] as const) {
        const value = str(flags[flag]);
        if (value !== undefined) patch[field] = value;
      }
      if (Object.keys(patch).length === 0) {
        return usage(deps, "assistants update: nothing to change");
      }
      const updated = await client.assistants.update(rest[0], patch);
      emit(`Updated ${updated.id}`, updated);
      return EXIT.ok;
    }
    case "delete": {
      if (!rest[0]) return usage(deps, "assistants delete <id> --yes");
      if (flags.yes !== true) {
        deps.stderr(
          "Deleting an assistant is permanent (knowledge cascades). Re-run with --yes."
        );
        return EXIT.usage;
      }
      await client.assistants.delete(rest[0]);
      emit(`Deleted ${rest[0]}`, { deleted: rest[0] });
      return EXIT.ok;
    }
    case "duplicate": {
      if (!rest[0]) return usage(deps, "assistants duplicate <id>");
      const copy = await client.assistants.duplicate(rest[0]);
      emit(`Created ${copy.id} ("${copy.title}")`, copy);
      return EXIT.ok;
    }
    case "get-entities": {
      if (!rest[0]) return usage(deps, "assistants get-entities <id>");
      const selection = await client.assistants.entities(rest[0]);
      emit(selection.entityIds.join("\n"), selection);
      return EXIT.ok;
    }
    case "set-entities": {
      if (!rest[0] || str(flags.ids) === undefined) {
        return usage(deps, "assistants set-entities <id> --ids <entityId,…>");
      }
      const entityIds = (str(flags.ids) ?? "")
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean);
      const selection = await client.assistants.setEntities(rest[0], entityIds);
      emit(`Selected ${selection.entityIds.length} Entities`, selection);
      return EXIT.ok;
    }
    case "get-skills": {
      if (!rest[0]) return usage(deps, "assistants get-skills <id>");
      const result = await client.assistants.skills(rest[0]);
      emit(result.data.map((skill) => skill.id).join("\n"), result);
      return EXIT.ok;
    }
    case "set-skills": {
      if (!rest[0] || str(flags.ids) === undefined) {
        return usage(deps, "assistants set-skills <id> --ids <skillId,…>");
      }
      const skillIds = (str(flags.ids) ?? "")
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean);
      const result = await client.assistants.setSkills(rest[0], skillIds);
      emit(`Selected ${result.data.length} Skills`, result);
      return EXIT.ok;
    }
    default:
      return usage(deps, "assistants <list|get|create|update|delete|duplicate|get-entities|set-entities|get-skills|set-skills>");
  }
}
