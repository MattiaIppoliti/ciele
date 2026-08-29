import { readFileSync } from "node:fs";
import type { SupportChannelInput, SupportChannelPatch } from "@agent-hub/core";
import { EXIT } from "../index.ts";
import { table } from "../output.ts";
import { str, usage, type CommandContext } from "./shared.ts";

function jsonFile<T>(ctx: CommandContext, hint: string): T | number {
  const path = str(ctx.flags.file);
  if (!path) return usage(ctx.deps, hint);
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

export async function helpDesks(verb: string | undefined, ctx: CommandContext) {
  const { client, flags, rest, emit, deps } = ctx;
  switch (verb) {
    case "list": {
      const result = await client.helpDesks.list();
      emit(
        table(result.data, [
          { key: "id", header: "ID" },
          { key: "name", header: "Name" },
          { key: "description", header: "Description" },
        ]),
        result
      );
      return EXIT.ok;
    }
    case "get": {
      if (!rest[0]) return usage(deps, "help-desks get <id>");
      const result = await client.helpDesks.get(rest[0]);
      emit(JSON.stringify(result, null, 2), result);
      return EXIT.ok;
    }
    case "create": {
      const name = str(flags.name);
      if (!name) return usage(deps, "help-desks create --name <name> [--description <text>]");
      const desk = await client.helpDesks.create({
        name,
        description: str(flags.description),
      });
      emit(`Created ${desk.id}`, desk);
      return EXIT.ok;
    }
    case "update": {
      if (!rest[0]) return usage(deps, "help-desks update <id> [--name|--description|--auto-improvements]");
      const auto = str(flags["auto-improvements"]);
      const patch = {
        name: str(flags.name),
        description: str(flags.description),
        autoGenerateImprovements:
          auto === undefined ? undefined : auto === "true" ? true : auto === "false" ? false : undefined,
      };
      if (
        patch.name === undefined &&
        patch.description === undefined &&
        patch.autoGenerateImprovements === undefined
      ) {
        return usage(deps, "help-desks update <id> [--name|--description|--auto-improvements true|false]");
      }
      const desk = await client.helpDesks.update(rest[0], patch);
      emit(`Updated ${desk.id}`, desk);
      return EXIT.ok;
    }
    case "delete":
      if (!rest[0] || flags.yes !== true) return usage(deps, "help-desks delete <id> --yes");
      await client.helpDesks.delete(rest[0]);
      emit(`Deleted ${rest[0]}`, { deleted: rest[0] });
      return EXIT.ok;
    case "add-channel": {
      if (!rest[0]) return usage(deps, "help-desks add-channel <deskId> --file <channel.json>");
      const input = jsonFile<SupportChannelInput>(ctx, "help-desks add-channel <deskId> --file <channel.json>");
      if (typeof input === "number") return input;
      const channel = await client.helpDesks.addChannel(rest[0], input);
      emit(`Created channel ${channel.id}`, channel);
      return EXIT.ok;
    }
    case "update-channel": {
      if (!rest[0] || !rest[1]) {
        return usage(deps, "help-desks update-channel <deskId> <channelId> --file <patch.json>");
      }
      const patch = jsonFile<SupportChannelPatch>(
        ctx,
        "help-desks update-channel <deskId> <channelId> --file <patch.json>"
      );
      if (typeof patch === "number") return patch;
      const channel = await client.helpDesks.updateChannel(rest[0], rest[1], patch);
      emit(`Updated channel ${channel.id}`, channel);
      return EXIT.ok;
    }
    case "delete-channel":
      if (!rest[0] || !rest[1] || flags.yes !== true) {
        return usage(deps, "help-desks delete-channel <deskId> <channelId> --yes");
      }
      await client.helpDesks.deleteChannel(rest[0], rest[1]);
      emit(`Deleted channel ${rest[1]}`, { deleted: rest[1] });
      return EXIT.ok;
    case "reorder-channels": {
      const ids = str(flags.ids)?.split(",").map((id) => id.trim()).filter(Boolean);
      if (!rest[0] || !ids?.length) {
        return usage(deps, "help-desks reorder-channels <deskId> --ids <id,id,…>");
      }
      const result = await client.helpDesks.reorderChannels(rest[0], ids);
      emit(`Reordered ${result.data.length} channels`, result);
      return EXIT.ok;
    }
    case "connect-servicenow": {
      if (!rest[0]) return usage(deps, "help-desks connect-servicenow <deskId> --file <credentials.json>");
      const input = jsonFile<Parameters<typeof client.helpDesks.connectServiceNow>[1]>(
        ctx,
        "help-desks connect-servicenow <deskId> --file <credentials.json>"
      );
      if (typeof input === "number") return input;
      const desk = await client.helpDesks.connectServiceNow(rest[0], input);
      emit(`Connected ServiceNow to ${desk.id}`, desk);
      return EXIT.ok;
    }
    case "disconnect-ticketing":
      if (!rest[0] || flags.yes !== true) {
        return usage(deps, "help-desks disconnect-ticketing <deskId> --yes");
      }
      emit(
        `Disconnected ticketing from ${rest[0]}`,
        await client.helpDesks.disconnectTicketing(rest[0])
      );
      return EXIT.ok;
    default:
      return usage(
        deps,
        "help-desks <list|get|create|update|delete|add-channel|update-channel|delete-channel|reorder-channels|connect-servicenow|disconnect-ticketing>"
      );
  }
}
