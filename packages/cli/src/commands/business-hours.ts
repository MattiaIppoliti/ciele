import type { BusinessHoursInput, BusinessHoursPatch } from "@ciele/client";
import { EXIT } from "../index.ts";
import { table } from "../output.ts";
import { confirmed, jsonFile, usage, type CommandContext } from "./shared.ts";
export async function businessHours(verb: string | undefined, ctx: CommandContext) {
  const { client, rest, flags, deps, emit } = ctx;
  if (verb !== "list" && !confirmed(flags)) return usage(deps, "business-hours <create|update|delete|timezone> --yes");
  switch (verb) {
    case "list": {
    const result = await client.businessHours.list();
    emit(table(result.data, [{ key: "id", header: "ID" }, { key: "name", header: "Name" }, { key: "timezone", header: "Timezone" }, { key: "isDefault", header: "Default" }]), result);
    return EXIT.ok;
      }
    case "create": {
      const input = jsonFile<BusinessHoursInput>(ctx, "business-hours create --file <schedule.json> --yes");
      if (!input) return EXIT.usage;
      const result = await client.businessHours.create(input);
      emit(`Created ${result.id}`, result); return EXIT.ok;
    }
    case "update": {
      if (!rest[0]) return usage(deps, "business-hours update <id> --file <patch.json> --yes");
      const patch = jsonFile<BusinessHoursPatch>(ctx, "business-hours update <id> --file <patch.json> --yes");
      if (!patch) return EXIT.usage;
      const result = await client.businessHours.update(rest[0], patch);
      emit(`Updated ${result.id}`, result); return EXIT.ok;
    }
    case "delete":
      if (!rest[0]) return usage(deps, "business-hours delete <id> --yes");
      await client.businessHours.delete(rest[0]); emit(`Deleted ${rest[0]}`, { deleted: rest[0] }); return EXIT.ok;
    case "timezone": {
      if (!rest[0]) return usage(deps, "business-hours timezone <IANA-zone> --yes");
      const result = await client.businessHours.setTimezone(rest[0]); emit(result.timezone, result); return EXIT.ok;
    }
    default: return usage(deps, "business-hours <list|create|update|delete|timezone>");
  }
}
