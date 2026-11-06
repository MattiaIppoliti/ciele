import type { ExportScheduleInput, ExportSchedulePatch } from "@ciele/client";
import { EXIT } from "../index.ts";
import { table } from "../output.ts";
import { confirmed, jsonFile, usage, type CommandContext } from "./shared.ts";
export async function exportSchedules(verb: string | undefined, ctx: CommandContext) {
  const { client, rest, flags, deps, emit } = ctx;
  switch (verb) {
    case "list": { const result = await client.exportSchedules.list(); emit(table(result.items, [{ key: "id", header: "ID" }, { key: "name", header: "Name" }, { key: "enabled", header: "Enabled" }]), result); return EXIT.ok; }
    case "create": {
      if (!confirmed(flags)) return usage(deps, "exports create --file schedule.json --yes");
      const input = jsonFile<Omit<ExportScheduleInput, "organizationId" | "createdBy">>(ctx, "exports create --file schedule.json --yes");
      if (!input) return EXIT.usage;
      const result = await client.exportSchedules.create(input); emit(result.id, result); return EXIT.ok;
    }
    case "update": {
      if (!rest[0] || !confirmed(flags)) return usage(deps, "exports update <id> --file patch.json --yes");
      const patch = jsonFile<ExportSchedulePatch>(ctx, "exports update <id> --file patch.json --yes");
      if (!patch) return EXIT.usage;
      const result = await client.exportSchedules.update(rest[0], patch); emit(result.id, result); return EXIT.ok;
    }
    case "pause":
    case "resume": {
      if (!rest[0] || !confirmed(flags)) return usage(deps, "exports pause|resume <id> --yes");
      const result = await client.exportSchedules.update(rest[0], { enabled: verb === "resume" }); emit(result.id, result); return EXIT.ok;
    }
    case "delete": if (!rest[0] || !confirmed(flags)) return usage(deps, "exports delete <id> --yes"); await client.exportSchedules.delete(rest[0]); emit(`Deleted ${rest[0]}`, { deleted: rest[0] }); return EXIT.ok;
    default: return usage(deps, "exports list|create|update|pause|resume|delete");
  }
}
