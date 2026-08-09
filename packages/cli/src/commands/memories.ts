import { EXIT } from "../index.ts";
import { table } from "../output.ts";
import { str, usage, type CommandContext } from "./shared.ts";

export async function memories(verb: string | undefined, ctx: CommandContext) {
  const { client, flags, rest, emit, deps } = ctx;
  switch (verb) {
    case "status": {
      const settings = await client.memories.settings();
      emit(`Long-term memory is ${settings.enabled ? "enabled" : "disabled"}`, settings);
      return EXIT.ok;
    }
    case "enable":
    case "disable": {
      const settings = await client.memories.setEnabled(verb === "enable");
      emit(`Long-term memory is ${settings.enabled ? "enabled" : "disabled"}`, settings);
      return EXIT.ok;
    }
    case "subjects": {
      const page = await client.memories.subjects({
        limit: str(flags.limit) ? Number(str(flags.limit)) : undefined,
        cursor: str(flags.cursor),
      });
      emit(table(page.data, [
        { key: "subjectId", header: "Subject" },
        { key: "claimValue", header: "Claim" },
        { key: "memoryCount", header: "Count" },
        { key: "lastMemoryAt", header: "Last memory" },
      ]), page);
      return EXIT.ok;
    }
    case "list": {
      if (!rest[0]) return usage(deps, "memories list <subjectId>");
      const result = await client.memories.list(rest[0]);
      emit(JSON.stringify(result.data, null, 2), result);
      return EXIT.ok;
    }
    case "delete":
      if (!rest[0] || flags.yes !== true) return usage(deps, "memories delete <memoryId> --yes");
      await client.memories.delete(rest[0]);
      emit(`Deleted ${rest[0]}`, { deleted: rest[0] });
      return EXIT.ok;
    case "wipe":
      if (!rest[0] || flags.yes !== true) return usage(deps, "memories wipe <subjectId> --yes");
      await client.memories.wipe(rest[0]);
      emit(`Wiped memories for ${rest[0]}`, { wiped: rest[0] });
      return EXIT.ok;
    default:
      return usage(deps, "memories <status|enable|disable|subjects|list|delete|wipe>");
  }
}
