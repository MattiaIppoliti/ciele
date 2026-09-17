import { readFileSync } from "node:fs";
import type { TeammatePatch } from "@agent-hub/core";
import { EXIT } from "../index.ts";
import { table } from "../output.ts";
import { bool, str, strList, usage, type CommandContext } from "./shared.ts";

/**
 * AI Teammates (#768): the Organization's internal agents.
 *
 * A key acts as the Member who minted it, so `list` shows what that Member may
 * see and `conversations` reads their own thread. Delete is a soft delete: the
 * Teammate answers nothing more and its transcripts stay readable.
 */
export async function teammates(verb: string | undefined, ctx: CommandContext) {
  const { client, flags, rest, emit, deps } = ctx;
  switch (verb) {
    case "list": {
      const result = await client.teammates.list();
      emit(
        table(result.data, [
          { key: "id", header: "ID" },
          { key: "name", header: "Name" },
          { key: "title", header: "Title" },
          { key: "visibility", header: "Visibility" },
        ]),
        result
      );
      return EXIT.ok;
    }
    case "get": {
      if (!rest[0]) return usage(deps, "teammates get <id>");
      const teammate = await client.teammates.get(rest[0]);
      emit(JSON.stringify(teammate, null, 2), teammate);
      return EXIT.ok;
    }
    case "create": {
      const name = str(flags.name);
      if (!name) {
        return usage(
          deps,
          'teammates create --name <name> [--title <title>] [--role <text>] [--private] [--collections <id,id>] [--sources <id,id>]'
        );
      }
      const collections = str(flags.collections);
      // The other half of the Knowledge Scope: individual Library items
      // (websites, files, FAQs) rather than whole Collections.
      const sources = str(flags.sources);
      const teammate = await client.teammates.create({
        name,
        title: str(flags.title),
        roleDescription: str(flags.role),
        visibility: flags.private === true ? "private" : undefined,
        collectionIds: collections ? collections.split(",") : undefined,
        sourceIds: sources ? sources.split(",") : undefined,
      });
      emit(`Created ${teammate.id}`, teammate);
      return EXIT.ok;
    }
    case "update": {
      if (!rest[0]) {
        return usage(
          deps,
          "teammates update <id> [--name|--title|--role|--collections|--sources|--visibility]"
        );
      }
      const collections = str(flags.collections);
      const sources = str(flags.sources);
      const visibility = str(flags.visibility);
      const patch: TeammatePatch = {
        name: str(flags.name),
        title: str(flags.title),
        roleDescription: str(flags.role),
        collectionIds: collections ? collections.split(",") : undefined,
        sourceIds: sources ? sources.split(",") : undefined,
        visibility:
          visibility === "org" || visibility === "private" ? visibility : undefined,
      };
      if (Object.values(patch).every((value) => value === undefined)) {
        return usage(
          deps,
          "teammates update <id> [--name|--title|--role|--collections|--sources|--visibility org|private]"
        );
      }
      const teammate = await client.teammates.update(rest[0], patch);
      emit(`Updated ${teammate.id}`, teammate);
      return EXIT.ok;
    }
    case "delete": {
      if (!rest[0]) return usage(deps, "teammates delete <id> --yes");
      if (flags.yes !== true) {
        deps.stderr("Refusing to delete without --yes");
        return EXIT.usage;
      }
      await client.teammates.delete(rest[0]);
      emit(`Deleted ${rest[0]}`, { deleted: rest[0] });
      return EXIT.ok;
    }
    case "conversations": {
      if (!rest[0]) return usage(deps, "teammates conversations <id>");
      const result = await client.teammates.conversations(rest[0]);
      emit(
        table(result.data, [
          { key: "id", header: "ID" },
          { key: "title", header: "Title" },
          { key: "updatedAt", header: "Updated" },
        ]),
        result
      );
      return EXIT.ok;
    }
    case "conversation": {
      if (!rest[0] || !rest[1]) {
        return usage(deps, "teammates conversation <id> <conversationId>");
      }
      const result = await client.teammates.conversation(rest[0], rest[1]);
      emit(JSON.stringify(result, null, 2), result);
      return EXIT.ok;
    }
    case "provision": {
      // One call for the whole job. `--routine "text:cadence[:hour]"`, repeated,
      // because a routine is two or three fields and a JSON flag for that would
      // be worse to type than the thing it replaces.
      const name = str(flags.name);
      if (!name) {
        return usage(
          deps,
          'teammates provision --name <name> [--title <t>] [--role <text>] [--grants a,b] [--ceiling member|edit] [--routine "Do the thing:daily[:8]"]…'
        );
      }
      const routineFlags = strList(flags.routine);
      const routines = routineFlags.map((raw) => {
        const [instruction, cadence, hour] = raw.split(":");
        return {
          instruction: (instruction ?? "").trim(),
          cadence: (cadence ?? "daily").trim(),
          hour: hour === undefined ? undefined : Number(hour),
        };
      });
      const grants = str(flags.grants);
      const result = await client.teammates.provision({
        name,
        title: str(flags.title),
        roleDescription: str(flags.role),
        visibility: flags.private === true ? "private" : undefined,
        grants: grants ? grants.split(",").filter(Boolean) : undefined,
        ceiling: str(flags.ceiling),
        approvalBypass: bool(flags["approval-bypass"]),
        routines: routines.length ? routines : undefined,
      });
      const lines = [
        `Created teammate ${result.teammate.id} (${result.teammate.name})`,
        `Granted: ${result.governance?.domains.join(", ") || "(none)"}`,
        `Routines: ${result.routines.length}`,
      ];
      // A partial run is not a *usage* error: the command was invoked correctly
      // and the server refused one step, almost always because the key's Role
      // stops below `manageMembers`. Exit 2 would tell a script "you typed it
      // wrong"; exit 1 says "it did not fully work", which is the truth. The
      // teammate exists and is usable as far as it got, so this is not exit 0
      // either, and the line says where it stopped rather than making the
      // caller diff what it asked for against what came back.
      if (result.partial) {
        lines.push(`Stopped at ${result.partial}: ${result.reason ?? "unknown"}`);
      }
      emit(lines.join("\n"), result);
      return result.partial ? EXIT.error : EXIT.ok;
    }
    case "grants": {
      if (!rest[0]) return usage(deps, "teammates grants <teammateId>");
      const governance = await client.teammates.grants(rest[0]);
      emit(
        [
          `Domains: ${governance.domains.join(", ") || "(none: this teammate can answer, not act)"}`,
          `Ceiling: ${governance.ceiling}`,
          `Approval bypass: ${governance.approvalBypass ? "on" : "off"}`,
        ].join("\n"),
        governance
      );
      return EXIT.ok;
    }
    case "set-grants": {
      const domains = str(flags.domains);
      // The whole set, every time: `--domains ""` revokes. Undefined means the
      // flag was not given at all, which is a usage error rather than a revoke.
      if (!rest[0] || domains === undefined) {
        return usage(
          deps,
          'teammates set-grants <teammateId> --domains <a,b,…> [--ceiling member|edit] [--approval-bypass]   (--domains "" revokes all)'
        );
      }
      const governance = await client.teammates.setGrants(rest[0], {
        domains: domains ? domains.split(",").filter(Boolean) : [],
        ceiling: str(flags.ceiling),
        approvalBypass: bool(flags["approval-bypass"]),
      });
      emit(`Granted: ${governance.domains.join(", ") || "(none)"}`, governance);
      return EXIT.ok;
    }
    case "routines": {
      if (!rest[0]) return usage(deps, "teammates routines <teammateId>");
      const result = await client.teammates.routines(rest[0]);
      emit(
        table(result.data, [
          { key: "id", header: "ID" },
          { key: "cadence", header: "Cadence" },
          { key: "hour", header: "UTC hour" },
          { key: "enabled", header: "Enabled" },
          { key: "lastRunAt", header: "Last run" },
          { key: "instruction", header: "Instruction" },
        ]),
        result
      );
      return EXIT.ok;
    }
    case "add-routine": {
      const instruction = str(flags.instruction);
      const cadence = str(flags.cadence);
      if (!rest[0] || !instruction || !cadence) {
        return usage(
          deps,
          'teammates add-routine <teammateId> --instruction <text> --cadence daily|weekly|monthly [--hour 0-23]'
        );
      }
      const routine = await client.teammates.addRoutine(rest[0], {
        instruction,
        cadence,
        hour: flags.hour === undefined ? undefined : Number(flags.hour),
      });
      emit(`Created routine ${routine.id} (${routine.cadence})`, routine);
      return EXIT.ok;
    }
    case "update-routine": {
      if (!rest[0]) {
        return usage(
          deps,
          "teammates update-routine <routineId> [--instruction <t>] [--cadence <c>] [--hour <h>] [--enabled true|false]"
        );
      }
      const patch: {
        instruction?: string;
        cadence?: string;
        hour?: number;
        enabled?: boolean;
      } = {};
      if (str(flags.instruction)) patch.instruction = str(flags.instruction);
      if (str(flags.cadence)) patch.cadence = str(flags.cadence);
      if (flags.hour !== undefined) patch.hour = Number(flags.hour);
      if (flags.enabled !== undefined) patch.enabled = str(flags.enabled) !== "false";
      if (Object.keys(patch).length === 0) {
        return usage(deps, "teammates update-routine <routineId>: give at least one field to change");
      }
      const routine = await client.teammates.updateRoutine(rest[0], patch);
      emit(`Updated routine ${routine.id}`, routine);
      return EXIT.ok;
    }
    case "delete-routine": {
      if (!rest[0]) return usage(deps, "teammates delete-routine <routineId> --yes");
      if (flags.yes !== true) {
        deps.stderr("Deleting a routine stops its unattended runs. Re-run with --yes.");
        return EXIT.usage;
      }
      await client.teammates.deleteRoutine(rest[0]);
      emit(`Deleted routine ${rest[0]}`, { deleted: rest[0] });
      return EXIT.ok;
    }
    case "memory": {
      if (!rest[0]) return usage(deps, "teammates memory <teammateId>");
      const view = await client.teammates.memory(rest[0]);
      emit(
        [
          view.document?.body || "(this teammate has learned nothing yet)",
          "",
          `${view.entries.length} revision${view.entries.length === 1 ? "" : "s"}`,
        ].join("\n"),
        view
      );
      return EXIT.ok;
    }
    case "set-memory": {
      const file = str(flags.file);
      const body = str(flags.body) ?? (file ? readFileSync(file, "utf8") : undefined);
      if (!rest[0] || body === undefined) {
        return usage(
          deps,
          'teammates set-memory <teammateId> (--file <path> | --body <text>) [--note "why"]'
        );
      }
      const document = await client.teammates.setMemory(rest[0], {
        body,
        note: str(flags.note),
      });
      emit(`Wrote agent memory (${document.body.length} chars)`, document);
      return EXIT.ok;
    }
    default:
      return usage(
        deps,
        "teammates list|get|create|provision|update|delete|conversations|conversation|grants|set-grants|routines|add-routine|update-routine|delete-routine|memory|set-memory"
      );
  }
}
