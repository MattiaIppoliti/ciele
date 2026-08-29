import type { TeammatePatch } from "@agent-hub/core";
import { EXIT } from "../index.ts";
import { table } from "../output.ts";
import { str, usage, type CommandContext } from "./shared.ts";

/**
 * AI Teammates (#768): the Organization's internal agents.
 *
 * A key acts as the Member who minted it, so `list` shows what that Member may
 * see and `conversations` reads their own thread. Delete is a soft delete: the
 * Teammate answers nothing more and its transcripts stay readable.
 */
export async function teammates(verb: string | undefined, ctx: CommandContext) {
  const { client, flags, rest, emit, deps } = ctx;
  switch (verb) {
    case "list": {
      const result = await client.teammates.list();
      emit(
        table(result.data, [
          { key: "id", header: "ID" },
          { key: "name", header: "Name" },
          { key: "title", header: "Title" },
          { key: "visibility", header: "Visibility" },
        ]),
        result
      );
      return EXIT.ok;
    }
    case "get": {
      if (!rest[0]) return usage(deps, "teammates get <id>");
      const teammate = await client.teammates.get(rest[0]);
      emit(JSON.stringify(teammate, null, 2), teammate);
      return EXIT.ok;
    }
    case "create": {
      const name = str(flags.name);
      if (!name) {
        return usage(
          deps,
          'teammates create --name <name> [--title <title>] [--role <text>] [--private] [--collections <id,id>] [--sources <id,id>]'
        );
      }
      const collections = str(flags.collections);
      // The other half of the Knowledge Scope: individual Library items
      // (websites, files, FAQs) rather than whole Collections.
      const sources = str(flags.sources);
      const teammate = await client.teammates.create({
        name,
        title: str(flags.title),
        roleDescription: str(flags.role),
        visibility: flags.private === true ? "private" : undefined,
        collectionIds: collections ? collections.split(",") : undefined,
        sourceIds: sources ? sources.split(",") : undefined,
      });
      emit(`Created ${teammate.id}`, teammate);
      return EXIT.ok;
    }
    case "update": {
      if (!rest[0]) {
        return usage(
          deps,
          "teammates update <id> [--name|--title|--role|--collections|--sources|--visibility]"
        );
      }
      const collections = str(flags.collections);
      const sources = str(flags.sources);
      const visibility = str(flags.visibility);
      const patch: TeammatePatch = {
        name: str(flags.name),
        title: str(flags.title),
        roleDescription: str(flags.role),
        collectionIds: collections ? collections.split(",") : undefined,
        sourceIds: sources ? sources.split(",") : undefined,
        visibility:
          visibility === "org" || visibility === "private" ? visibility : undefined,
      };
      if (Object.values(patch).every((value) => value === undefined)) {
        return usage(
          deps,
          "teammates update <id> [--name|--title|--role|--collections|--sources|--visibility org|private]"
        );
      }
      const teammate = await client.teammates.update(rest[0], patch);
      emit(`Updated ${teammate.id}`, teammate);
      return EXIT.ok;
    }
    case "delete": {
      if (!rest[0]) return usage(deps, "teammates delete <id> --yes");
      if (flags.yes !== true) {
        deps.stderr("Refusing to delete without --yes");
        return EXIT.usage;
      }
      await client.teammates.delete(rest[0]);
      emit(`Deleted ${rest[0]}`, { deleted: rest[0] });
      return EXIT.ok;
    }
    case "conversations": {
      if (!rest[0]) return usage(deps, "teammates conversations <id>");
      const result = await client.teammates.conversations(rest[0]);
      emit(
        table(result.data, [
          { key: "id", header: "ID" },
          { key: "title", header: "Title" },
          { key: "updatedAt", header: "Updated" },
        ]),
        result
      );
      return EXIT.ok;
    }
    case "conversation": {
      if (!rest[0] || !rest[1]) {
        return usage(deps, "teammates conversation <id> <conversationId>");
      }
      const result = await client.teammates.conversation(rest[0], rest[1]);
      emit(JSON.stringify(result, null, 2), result);
      return EXIT.ok;
    }
    default:
      return usage(
        deps,
        "teammates list|get|create|update|delete|conversations|conversation"
      );
  }
}
