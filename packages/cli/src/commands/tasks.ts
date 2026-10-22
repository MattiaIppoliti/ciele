import { EXIT } from "../index.ts";
import { table } from "../output.ts";
import { str, usage, type CommandContext, confirmed } from "./shared.ts";

/**
 * Tasks (#1069): the work inside Projects. A key reads the Projects its Member
 * can read and comments as that Member.
 *
 * `update` takes the common fields as flags; anything else (labels, blockers,
 * moving to another Project) goes through `--json` with the PATCH body.
 * `list` pages with `--cursor`: the next page's cursor is printed under the
 * table and returned as `nextCursor` with `--json`.
 */
const STATUSES = ["backlog", "to_do", "in_progress", "in_review", "done"];
const PRIORITIES = ["urgent", "high", "medium", "low", "none"];

export async function tasks(verb: string | undefined, ctx: CommandContext) {
  const { client, flags, rest, emit, deps } = ctx;
  switch (verb) {
    case "list": {
      const result = await client.tasks.list({
        projectId: str(flags.project),
        assignee: str(flags.assignee),
        status: str(flags.status),
        label: str(flags.label),
        dueFrom: str(flags["due-from"]),
        dueTo: str(flags["due-to"]),
        q: str(flags.q),
        improvementId: str(flags.improvement),
        includeArchived: flags.archived !== undefined && str(flags.archived) !== "false",
        cursor: str(flags.cursor),
      });
      const rows = table(result.data, [
        { key: "id", header: "ID" },
        { key: "seq", header: "#" },
        { key: "title", header: "Title" },
        { key: "status", header: "Status" },
        { key: "priority", header: "Priority" },
        { key: "dueDate", header: "Due" },
      ]);
      emit(result.nextCursor ? `${rows}\n\nMore: --cursor ${result.nextCursor}` : rows, result);
      return EXIT.ok;
    }
    case "get": {
      if (!rest[0]) return usage(deps, "tasks get <id>");
      const detail = await client.tasks.get(rest[0]);
      emit(
        [
          `${detail.project.key}-${detail.task.seq} ${detail.task.title} (${detail.task.id})`,
          `${detail.task.status} · ${detail.task.priority}${detail.task.dueDate ? ` · due ${detail.task.dueDate}` : ""}`,
          "",
          detail.task.description || "(no description)",
          "",
          `${detail.subtasks.length} subtask${detail.subtasks.length === 1 ? "" : "s"} · blocked by ${detail.blockedBy.length}`,
        ].join("\n"),
        detail
      );
      return EXIT.ok;
    }
    case "create": {
      const projectId = str(flags.project);
      const title = str(flags.title);
      if (!projectId || !title) {
        return usage(
          deps,
          'tasks create --project <id> --title <title> [--status <s>] [--priority <p>] [--assignee <userId>] [--due YYYY-MM-DD] [--description <text>]'
        );
      }
      const status = str(flags.status);
      const priority = str(flags.priority);
      if (status && !STATUSES.includes(status)) return usage(deps, `--status is one of ${STATUSES.join(", ")}`);
      if (priority && !PRIORITIES.includes(priority)) return usage(deps, `--priority is one of ${PRIORITIES.join(", ")}`);
      const task = await client.tasks.create({
        projectId,
        title,
        description: str(flags.description),
        status: status as never,
        priority: priority as never,
        assigneeMemberId: str(flags.assignee),
        dueDate: str(flags.due),
      });
      emit(`Created task ${task.id}`, task);
      return EXIT.ok;
    }
    case "update": {
      const json = str(flags.json);
      const patch: Record<string, unknown> = {};
      if (str(flags.title)) patch.title = str(flags.title);
      if (str(flags.status)) patch.status = str(flags.status);
      if (str(flags.priority)) patch.priority = str(flags.priority);
      if (flags.assignee !== undefined) patch.assigneeMemberId = str(flags.assignee) || null;
      if (flags.due !== undefined) patch.dueDate = str(flags.due) || null;
      if (str(flags.description) !== undefined) patch.description = str(flags.description);
      const archived = flags.archive !== undefined ? true : flags.restore !== undefined ? false : undefined;
      if (!rest[0] || (!json && Object.keys(patch).length === 0 && archived === undefined)) {
        return usage(
          deps,
          "tasks update <id> [--title <t>] [--status <s>] [--priority <p>] [--assignee <userId>] [--due YYYY-MM-DD] [--description <text>] [--archive|--restore] [--json '<PATCH body>']"
        );
      }
      if (typeof patch.status === "string" && !STATUSES.includes(patch.status)) {
        return usage(deps, `--status is one of ${STATUSES.join(", ")}`);
      }
      const body = json
        ? (JSON.parse(json) as Record<string, unknown>)
        : { ...(Object.keys(patch).length ? { patch } : {}), ...(archived !== undefined ? { archived } : {}) };
      const task = await client.tasks.update(rest[0], body);
      emit(`Updated task ${task.id}`, task);
      return EXIT.ok;
    }
    case "delete": {
      if (!rest[0]) return usage(deps, "tasks delete <id> --yes");
      if (!confirmed(flags)) {
        deps.stderr(
          "Deleting a task removes its subtasks, comments and files. To delete anyway, re-run with --yes."
        );
        return EXIT.usage;
      }
      const result = await client.tasks.delete(rest[0]);
      emit(`Deleted task ${rest[0]}`, result);
      return EXIT.ok;
    }
    case "comments": {
      if (!rest[0]) return usage(deps, "tasks comments <id>");
      const result = await client.tasks.comments(rest[0]);
      emit(
        table(result.data, [
          { key: "createdAt", header: "When" },
          { key: "authorMemberId", header: "Author" },
          { key: "body", header: "Comment" },
        ]),
        result
      );
      return EXIT.ok;
    }
    case "comment": {
      const body = str(flags.body);
      if (!rest[0] || !body) return usage(deps, 'tasks comment <id> --body "text"');
      const comment = await client.tasks.comment(rest[0], body);
      emit(`Commented on ${rest[0]}`, comment);
      return EXIT.ok;
    }
    case "labels": {
      const result = await client.tasks.labels();
      emit(
        table(result.data, [
          { key: "id", header: "ID" },
          { key: "name", header: "Name" },
          { key: "color", header: "Color" },
        ]),
        result
      );
      return EXIT.ok;
    }
    case "create-label": {
      const name = str(flags.name);
      if (!name) return usage(deps, "tasks create-label --name <name> [--color gray|blue|green|amber|red|purple]");
      const label = await client.tasks.createLabel({ name, color: str(flags.color) as never });
      emit(`Created label ${label.id}`, label);
      return EXIT.ok;
    }
    case "update-label": {
      const name = str(flags.name);
      const color = str(flags.color);
      if (!rest[0] || (!name && !color)) {
        return usage(deps, "tasks update-label <id> [--name <name>] [--color gray|blue|green|amber|red|purple]");
      }
      const label = await client.tasks.updateLabel(rest[0], {
        ...(name ? { name } : {}),
        ...(color ? { color: color as never } : {}),
      });
      emit(`Updated label ${label.id}`, label);
      return EXIT.ok;
    }
    case "delete-label": {
      if (!rest[0]) return usage(deps, "tasks delete-label <id> --yes");
      if (!confirmed(flags)) {
        deps.stderr("Deleting a label removes it from every task that carries it. To delete anyway, re-run with --yes.");
        return EXIT.usage;
      }
      const result = await client.tasks.deleteLabel(rest[0]);
      emit(`Deleted label ${rest[0]}`, result);
      return EXIT.ok;
    }
    default:
      return usage(deps, "tasks <list|get|create|update|delete|comments|comment|labels|create-label|update-label|delete-label>");
  }
}
