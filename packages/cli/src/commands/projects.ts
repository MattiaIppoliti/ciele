import { readFileSync } from "node:fs";
import { EXIT } from "../index.ts";
import { table } from "../output.ts";
import { str, usage, type CommandContext } from "./shared.ts";

/**
 * Projects (#771): the shared workspace a Teammate attaches to, and the owner
 * of the Project memory layer.
 *
 * `get` prints the row and the document together, because for a Teammate they
 * are one thing: the document is injected whole into every turn it takes while
 * attached. `set-document` replaces the body and keeps the previous one in
 * history, which is what makes a revert a restore.
 */
export async function projects(verb: string | undefined, ctx: CommandContext) {
  const { client, flags, rest, emit, deps } = ctx;
  switch (verb) {
    case "list": {
      const result = await client.projects.list();
      emit(
        table(result.data, [
          { key: "id", header: "ID" },
          { key: "name", header: "Name" },
          { key: "archived", header: "Archived" },
          { key: "createdAt", header: "Created" },
        ]),
        result
      );
      return EXIT.ok;
    }
    case "get": {
      if (!rest[0]) return usage(deps, "projects get <id>");
      const view = await client.projects.get(rest[0]);
      emit(
        [
          `${view.project.name} (${view.project.id})`,
          view.project.description || "(no description)",
          "",
          view.document?.body || "(no project memory yet)",
          "",
          `${view.entries.length} revision${view.entries.length === 1 ? "" : "s"}`,
        ].join("\n"),
        view
      );
      return EXIT.ok;
    }
    case "create": {
      const name = str(flags.name);
      if (!name) {
        return usage(deps, 'projects create --name <name> [--description <text>]');
      }
      const project = await client.projects.create({
        name,
        description: str(flags.description),
      });
      emit(`Created project ${project.id}`, project);
      return EXIT.ok;
    }
    case "update": {
      const patch: { name?: string; description?: string; archived?: boolean } = {};
      if (str(flags.name)) patch.name = str(flags.name);
      if (str(flags.description) !== undefined) {
        patch.description = str(flags.description);
      }
      if (flags.archived !== undefined) {
        patch.archived = str(flags.archived) !== "false";
      }
      if (!rest[0] || Object.keys(patch).length === 0) {
        return usage(
          deps,
          "projects update <id> [--name <n>] [--description <d>] [--archived true|false]"
        );
      }
      const project = await client.projects.update(rest[0], patch);
      emit(`Updated project ${project.id}`, project);
      return EXIT.ok;
    }
    case "delete": {
      if (!rest[0]) return usage(deps, "projects delete <id> --yes");
      if (flags.yes !== true) {
        // Archiving is the move that keeps the record, so say so rather than
        // only asking for confirmation.
        deps.stderr(
          "Deleting a project removes its decisions and detaches its teammates. " +
            "To keep the record, run: projects update <id> --archived true. " +
            "To delete anyway, re-run with --yes."
        );
        return EXIT.usage;
      }
      await client.projects.delete(rest[0]);
      emit(`Deleted project ${rest[0]}`, { deleted: rest[0] });
      return EXIT.ok;
    }
    case "set-document": {
      const file = str(flags.file);
      const body = str(flags.body) ?? (file ? readFileSync(file, "utf8") : undefined);
      if (!rest[0] || body === undefined) {
        return usage(
          deps,
          'projects set-document <id> (--file <path> | --body <text>) [--note "why"]'
        );
      }
      const document = await client.projects.setDocument(rest[0], {
        body,
        note: str(flags.note),
      });
      emit(`Wrote project memory (${document.body.length} chars)`, document);
      return EXIT.ok;
    }
    default:
      return usage(deps, "projects <list|get|create|update|delete|set-document>");
  }
}
