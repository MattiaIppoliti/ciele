import { writeFileSync } from "node:fs";
import { EXIT } from "../index.ts";
import { table } from "../output.ts";
import { str, usage, type CommandContext } from "./shared.ts";

/** `ciele conversations …` (#628) — read-only, any key role. */
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
    default:
      return usage(deps, "conversations <list|get|export>");
  }
}
