import { writeFileSync } from "node:fs";
import { EXIT } from "../index.ts";
import { table } from "../output.ts";
import { str, usage, type CommandContext } from "./shared.ts";

/** `ciele conversations …` (#628), read-only, any key role. */
export async function conversations(
  verb: string | undefined,
  ctx: CommandContext
): Promise<number> {
  const { client, rest, flags, emit, deps } = ctx;
  switch (verb) {
    case "list": {
      const page = await client.conversations.list({
        assistantId: str(flags.assistant),
        limit: str(flags.limit) ? Number(str(flags.limit)) : undefined,
        cursor: str(flags.cursor),
      });
      emit(
        table(page.data, [
          { key: "id", header: "Id" },
          { key: "assistantId", header: "Assistant" },
        ]) + (page.nextCursor ? `\n(next: --cursor ${page.nextCursor})` : ""),
        page
      );
      return EXIT.ok;
    }
    case "get": {
      if (!rest[0]) return usage(deps, "conversations get <id>");
      const detail = await client.conversations.get(rest[0]);
      emit(JSON.stringify(detail, null, 2), detail);
      return EXIT.ok;
    }
    case "export": {
      if (rest.length === 0) {
        return usage(deps, "conversations export <id> [<id>…] [--out <file.json>]");
      }
      const { data } = await client.conversations.export(rest);
      const out = str(flags.out);
      if (out) {
        writeFileSync(out, `${JSON.stringify(data, null, 2)}\n`, "utf8");
        emit(`Wrote ${data.length} records to ${out}`, { records: data.length, out });
      } else {
        emit(JSON.stringify(data, null, 2), { data });
      }
      return EXIT.ok;
    }
    case "pin":
    case "unpin": {
      if (!rest[0]) return usage(deps, `conversations ${verb} <id>`);
      const conversation = await client.conversations.setPinned(rest[0], verb === "pin");
      emit(`${verb === "pin" ? "Pinned" : "Unpinned"} ${rest[0]}`, conversation);
      return EXIT.ok;
    }
    case "feedback": {
      const text = str(flags.text);
      if (!rest[0] || !text) return usage(deps, "conversations feedback <id> --text <message>");
      const conversation = await client.conversations.feedback(rest[0], text);
      emit(`Feedback saved for ${rest[0]}`, conversation);
      return EXIT.ok;
    }
    case "delete":
      if (!rest[0] || flags.yes !== true) return usage(deps, "conversations delete <id> --yes");
      await client.conversations.delete(rest[0]);
      emit(`Deleted ${rest[0]}`, { deleted: rest[0] });
      return EXIT.ok;
    default:
      return usage(deps, "conversations <list|get|export|pin|unpin|feedback|delete>");
  }
}

export async function messages(
  verb: string | undefined,
  ctx: CommandContext
): Promise<number> {
  const { client, rest, flags, emit, deps } = ctx;
  if (verb !== "feedback" || !rest[0]) {
    return usage(deps, "messages feedback <id> --value <-1|0|1>");
  }
  const raw = str(flags.value);
  const feedback = raw === "-1" ? -1 : raw === "0" ? 0 : raw === "1" ? 1 : null;
  if (feedback === null) return usage(deps, "messages feedback <id> --value <-1|0|1>");
  const result = await client.messages.setFeedback(rest[0], feedback);
  emit(`Feedback saved for ${rest[0]}`, result);
  return EXIT.ok;
}
