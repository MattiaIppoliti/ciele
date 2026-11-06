import { IMPROVEMENT_PRIORITY_VALUES, IMPROVEMENT_STATUS_VALUES, type ImprovementPatch } from "@agent-hub/core";
import { EXIT } from "../index.ts";
import { table } from "../output.ts";
import { str, usage, type CommandContext, pageParams, emitJson } from "./shared.ts";

/** `ciele improvements …` (#628): sync the answer-quality kanban. */
export async function improvements(
  verb: string | undefined,
  ctx: CommandContext
): Promise<number> {
  const { client, rest, flags, emit, deps } = ctx;
  switch (verb) {
    case "list": {
      const status = IMPROVEMENT_STATUS_VALUES.find((value) => value === str(flags.status));
      const priority = IMPROVEMENT_PRIORITY_VALUES.find((value) => value === str(flags.priority));
      if ((flags.status !== undefined && !status) || (flags.priority !== undefined && !priority)) return usage(deps, "Invalid Improvement status or priority");
      const page = await client.improvements.list({
        ...pageParams(flags),
        search: str(flags.search),
        priority,
        status,
        assistantId: str(flags.assistant),
        projectId: str(flags.project),
        ...(flags.assignee !== undefined ? { assigneeId: str(flags.assignee) || null } : {}),
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
      emitJson(emit, detail);
      return EXIT.ok;
    }
    case "update": {
      if (!rest[0]) {
        return usage(
          deps,
          "improvements update <id> [--status|--priority|--assignee|--project|--due|--title|--description|--tags a,b]"
        );
      }
      const patch: ImprovementPatch = {};
      const title = str(flags.title);
      const description = str(flags.description);
      const status = IMPROVEMENT_STATUS_VALUES.find((value) => value === str(flags.status));
      const priority = IMPROVEMENT_PRIORITY_VALUES.find((value) => value === str(flags.priority));
      if ((flags.status !== undefined && !status) || (flags.priority !== undefined && !priority)) return usage(deps, "Invalid Improvement status or priority");
      const tags = str(flags.tags);
      if (title !== undefined) patch.title = title;
      if (description !== undefined) patch.description = description;
      if (status !== undefined) patch.status = status;
      if (priority !== undefined) patch.priority = priority;
      if (tags !== undefined) patch.tags = tags ? tags.split(",") : [];
      if (flags.assignee !== undefined) {
        patch.assigneeId = str(flags.assignee) || null;
      }
      if (flags.project !== undefined) patch.projectId = str(flags.project) || null;
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
