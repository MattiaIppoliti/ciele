import type { ImprovementPatch } from "@agent-hub/core";
import { EXIT } from "../index.ts";
import { table } from "../output.ts";
import { str, usage, type CommandContext } from "./shared.ts";

/** `ciele improvements …` (#628): sync the answer-quality kanban. */
export async function improvements(
  verb: string | undefined,
  ctx: CommandContext
): Promise<number> {
  const { client, rest, flags, emit, deps } = ctx;
  switch (verb) {
    case "list": {
      const page = await client.improvements.list({
        limit: str(flags.limit) ? Number(str(flags.limit)) : undefined,
        cursor: str(flags.cursor),
      });
      emit(
        table(page.data, [
          { key: "id", header: "Id" },
          { key: "seq", header: "Seq" },
          { key: "title", header: "Title" },
          { key: "status", header: "Status" },
          { key: "priority", header: "Priority" },
        ]) + (page.nextCursor ? `\n(next: --cursor ${page.nextCursor})` : ""),
        page
      );
      return EXIT.ok;
    }
    case "get": {
      if (!rest[0]) return usage(deps, "improvements get <id>");
      const detail = await client.improvements.get(rest[0]);
      emit(JSON.stringify(detail, null, 2), detail);
      return EXIT.ok;
    }
    case "update": {
      if (!rest[0]) {
        return usage(
          deps,
          "improvements update <id> [--status|--priority|--assignee|--due|--title|--description|--tags a,b]"
        );
      }
      const patch: ImprovementPatch = {};
      const title = str(flags.title);
      const description = str(flags.description);
      const status = str(flags.status);
      const priority = str(flags.priority);
      const tags = str(flags.tags);
      if (title !== undefined) patch.title = title;
      if (description !== undefined) patch.description = description;
      if (status !== undefined) patch.status = status as ImprovementPatch["status"];
      if (priority !== undefined) {
        patch.priority = (priority === "none" ? null : priority) as ImprovementPatch["priority"];
      }
      if (tags !== undefined) patch.tags = tags ? tags.split(",") : [];
      if (flags.assignee !== undefined) {
        patch.assigneeId = str(flags.assignee) || null;
      }
      if (flags.due !== undefined) {
        patch.dueDate = str(flags.due) || null;
      }
      if (Object.keys(patch).length === 0) {
        return usage(deps, "improvements update: nothing to change");
      }
      const updated = await client.improvements.update(rest[0], patch);
      emit(`Updated ${rest[0]}`, updated);
      return EXIT.ok;
    }
    default:
      return usage(deps, "improvements <list|get|update>");
  }
}
