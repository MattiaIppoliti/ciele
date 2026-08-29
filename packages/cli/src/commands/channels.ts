import { EXIT } from "../index.ts";
import { table } from "../output.ts";
import { str, usage, type CommandContext } from "./shared.ts";

/**
 * Teammate channels (#778): the group threads Members share with Teammates.
 *
 * A key acts as the Member who minted it, and membership is the visibility rule,
 * so `list` shows that Member's channels and nothing else. There is no `post`
 * verb: a message starts a bounded chain of model turns, which lives on the
 * console's streaming route rather than in a request/response command.
 */
export async function channels(
  verb: string | undefined,
  ctx: CommandContext
) {
  const { client, flags, rest, emit, deps } = ctx;
  switch (verb) {
    case "list": {
      const result = await client.channels.list();
      emit(
        table(
          result.data.map((row) => ({
            id: row.channel.id,
            name: row.channel.name,
            people: row.memberIds.length,
            teammates: row.teammateIds.length,
            unread: row.unread.count,
          })),
          [
            { key: "id", header: "ID" },
            { key: "name", header: "Name" },
            { key: "people", header: "People" },
            { key: "teammates", header: "Teammates" },
            { key: "unread", header: "Unread" },
          ]
        ),
        result
      );
      return EXIT.ok;
    }
    case "get": {
      if (!rest[0]) return usage(deps, "channels get <id>");
      const view = await client.channels.get(rest[0]);
      emit(JSON.stringify(view, null, 2), view);
      return EXIT.ok;
    }
    case "create": {
      const name = str(flags.name);
      if (!name) {
        return usage(
          deps,
          'channels create --name <name> [--teammates <id,id>] [--members <userId,userId>] [--project <id>]'
        );
      }
      const teammates = str(flags.teammates);
      const members = str(flags.members);
      const channel = await client.channels.create({
        name,
        teammateIds: teammates ? teammates.split(",") : undefined,
        memberIds: members ? members.split(",") : undefined,
        projectId: str(flags.project),
      });
      emit(`Created ${channel.id}`, channel);
      return EXIT.ok;
    }
    case "update": {
      if (!rest[0]) {
        return usage(deps, "channels update <id> [--name <name>] [--project <id|none>]");
      }
      const project = str(flags.project);
      const patch = {
        name: str(flags.name),
        // `--project none` unbinds: an empty string would be a name, not an
        // absence, and the API distinguishes the two.
        projectId: project === undefined ? undefined : project === "none" ? null : project,
      };
      if (Object.values(patch).every((value) => value === undefined)) {
        return usage(deps, "channels update <id> [--name <name>] [--project <id|none>]");
      }
      const channel = await client.channels.update(rest[0], patch);
      emit(`Updated ${channel.id}`, channel);
      return EXIT.ok;
    }
    case "delete": {
      if (!rest[0]) return usage(deps, "channels delete <id> --yes");
      if (flags.yes !== true) {
        // Closing a channel takes its transcript with it, unlike retiring a
        // Teammate, which keeps one.
        deps.stderr("Refusing to close a channel without --yes");
        return EXIT.usage;
      }
      await client.channels.delete(rest[0]);
      emit(`Closed ${rest[0]}`, { deleted: rest[0] });
      return EXIT.ok;
    }
    case "add-member": {
      if (!rest[0] || !rest[1]) {
        return usage(deps, "channels add-member <id> <userId> [<userId>…]");
      }
      await client.channels.addMembers(rest[0], rest.slice(1));
      emit(`Invited ${rest.slice(1).join(", ")}`, { added: rest.slice(1) });
      return EXIT.ok;
    }
    case "remove-member": {
      if (!rest[0] || !rest[1]) {
        return usage(deps, "channels remove-member <id> <userId>");
      }
      await client.channels.removeMember(rest[0], rest[1]);
      emit(`Removed ${rest[1]}`, { removed: rest[1] });
      return EXIT.ok;
    }
    case "add-teammate": {
      if (!rest[0] || !rest[1]) {
        return usage(deps, "channels add-teammate <id> <teammateId> [<teammateId>…]");
      }
      await client.channels.addTeammates(rest[0], rest.slice(1));
      emit(`Seated ${rest.slice(1).join(", ")}`, { added: rest.slice(1) });
      return EXIT.ok;
    }
    case "remove-teammate": {
      if (!rest[0] || !rest[1]) {
        return usage(deps, "channels remove-teammate <id> <teammateId>");
      }
      await client.channels.removeTeammate(rest[0], rest[1]);
      emit(`Removed ${rest[1]}`, { removed: rest[1] });
      return EXIT.ok;
    }
    default:
      return usage(
        deps,
        "channels list|get|create|update|delete|add-member|remove-member|add-teammate|remove-teammate"
      );
  }
}
