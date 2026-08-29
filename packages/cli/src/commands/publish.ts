import { EXIT } from "../index.ts";
import { usage, type CommandContext } from "./shared.ts";

/** `ciele publish …` (#628): status | create | remove | restore. */
export async function publish(
  verb: string | undefined,
  ctx: CommandContext
): Promise<number> {
  const { client, rest, flags, emit, deps } = ctx;
  switch (verb) {
    case "status": {
      if (!rest[0]) return usage(deps, "publish status <assistantId>");
      const status = await client.publish.status(rest[0]);
      emit(
        status.published
          ? `Published: version ${status.version} (${status.publicationId}) since ${status.publishedAt}`
          : "Not published",
        status
      );
      return EXIT.ok;
    }
    case "create": {
      if (!rest[0]) return usage(deps, "publish create <assistantId>");
      const result = await client.publish.publish(rest[0]);
      emit(`Published version ${result.version}`, result);
      return EXIT.ok;
    }
    case "remove": {
      if (!rest[0]) return usage(deps, "publish remove <assistantId> --yes");
      if (flags.yes !== true) {
        deps.stderr("Unpublishing takes the widget offline. Re-run with --yes.");
        return EXIT.usage;
      }
      await client.publish.unpublish(rest[0]);
      emit(`Unpublished ${rest[0]}`, { unpublished: rest[0] });
      return EXIT.ok;
    }
    case "restore": {
      if (!rest[0] || !rest[1]) {
        return usage(deps, "publish restore <assistantId> <publicationId>");
      }
      const result = await client.publish.republish(rest[0], rest[1]);
      emit(`Republished as version ${result.version}`, result);
      return EXIT.ok;
    }
    default:
      return usage(deps, "publish <status|create|remove|restore>");
  }
}
